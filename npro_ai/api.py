import frappe
import json
from frappe import _
from frappe.utils import getdate
import otto.lib as otto
from otto.lib import content, quick_query
from frappe.desk.form.utils import get_pdf_link

ai_provider = frappe.db.get_single_value('Npro AI Settings', 'ai_provider')

# ==================== Check Attachment Format ==========================

@frappe.whitelist()
def check_attached_file_format(file):
	if not file.lower().endswith(".pdf"):
		frappe.msgprint(_("Only PDF files are allowed. Please upload a PDF file."))
		return True
		
# ==================== JRSS Generation from JD ==========================

@frappe.whitelist()
def generate_jrss_from_job_description(jd_file, generate_jrss_prompt, additional_instructions, session_id=None):
	# print("================generate_jrss_from_job_description======================")

	if not jd_file.lower().endswith(".pdf"):
		return {"error": "LLM Only Supports PDF Files"}

	model = otto.get_model(size="Small", provider=ai_provider)

	if not session_id:
		session = otto.new(
			model=model,
			instruction="Create JRSS From Given JD",
		)
		session_id = session.id
		ai_prompt = generate_jrss_prompt + " " + additional_instructions + " give me output in HTML Format(css not require).(Only give 4 mandatory skills, 4 optional skills & 1 extra skill)"
		stream = session.interact([content.file(jd_file, name="jd.pdf") ,ai_prompt], stream=True)

	else:
		session = otto.load(session_id)
		ai_prompt = generate_jrss_prompt + " " +  additional_instructions + "\n" + "give me output in HTML Format."
		stream = session.interact(ai_prompt, stream=True)

	try:
		for chunk in stream:
			frappe.realtime.publish_realtime(
				"stream-llm",
				{
					"llm": model,
					"chunk": chunk,
				},
				user=frappe.session.user,
			)

	except Exception as e:
		return {"error": str(e)}

	if stream.failure_reason:
		return {"error": stream.failure_reason}

	if stream.item is None:
		return {
			"message": "success",
		}

	return {
		"message": "success",
		"item": stream.item,
		"session_id": session_id,
	}

@frappe.whitelist()
def fill_jrss_from_generated_content(docname, session_id):
	job_opeing = frappe.get_doc("Job Opening", docname)

	job_opeing.custom_session_id = session_id

	session = otto.load(session_id)
	ai_prompt = """ Give me List of Json Objects From last response, In Following Format Only:
		example: [
		{
			"skill_type": "Mandatory Skills",
			"skill_list": ["skill1", "skill2"]
		},
		{
			"skill_type": "Optional Skills"
			"skill_list": ["skill3", "skill4]
		},
		{
			"skill_type": "Extra Skills"
			"skill_list": ["skill5"] 
		}
		]
	  """
	# weightage between 0 to 1 (e.g., 0.1, 0.2,..., 0.5) --> to be add this in prompt
	
	response, _ = session.interact(ai_prompt, stream=False)

	if response:
		# print(response["content"], "==============response_content==================")
		response_content = response['content'][0]['text']

		skills_list = parse_json_string(response_content)
		# print(skills_list, "==============skills_list==================", type(skills_list))

		if isinstance(skills_list, list):
			for skill_obj in skills_list:
				if skill_obj.get("skill_type") == "Mandatory Skills" and len(skill_obj.get("skill_list")) > 0:
					for mandatory_skill in skill_obj.get("skill_list"):
						skill = job_opeing.append("custom_jrss_mandatory_skills", {})
						skill.skill= mandatory_skill

				if skill_obj.get("skill_type") == "Optional Skills" and len(skill_obj.get("skill_list")) > 0:
					for optional_skill in skill_obj.get("skill_list"):
						skill = job_opeing.append("custom_jrss_optional_skills", {})
						skill.skill= optional_skill

				if skill_obj.get("skill_type") == "Extra Skills" and len(skill_obj.get("skill_list")) > 0:
					for extra_skill in skill_obj.get("skill_list"):
						skill = job_opeing.append("custom_jrss_optional_skills", {})
						skill.skill = extra_skill

		job_opeing.save()
		return "JRSS Updated Successfully"
	

# ==================== Generate Technical Questions ==========================

@frappe.whitelist()
def generate_technical_questions_from_jrss(technical_question_prompt, additional_instructions, session_id):
	if not session_id:
		return {"error": "Create JRSS First to Generate Technical Questions."}

	session = otto.load(session_id)

	model = otto.get_model(size="Small", provider=ai_provider)
	ai_prompt = technical_question_prompt + "\n" + additional_instructions + "\n" + "give me output in HTML Order List Format and do not give extra details which are not asked."
	stream = session.interact(ai_prompt, stream=True)

	try:
		for chunk in stream:
			frappe.realtime.publish_realtime(
				"stream-llm",
				{
					"llm": model,
					"chunk": chunk,
				},
				user=frappe.session.user,
			)
	except Exception as e:
		return {"error": str(e)}

	if stream.failure_reason:
		return {"error": stream.failure_reason}

	if stream.item is None:
		return {
			"message": "success",
		}

	return {
		"message": "success",
		"item": stream.item,
	}

@frappe.whitelist()
def fill_technical_questions(docname, ai_response):
	job_opeing = frappe.get_doc("Job Opening", docname)
	# session_id = job_opeing.custom_session_id

	# session = otto.load(session_id)
	# ai_prompt = """Give me Last Generated technical questions only(no headings or other details) in HTML Format.
	# 				Example: <ol><li>Question 1?</li><li>Question 2?</li></ol>
	# 			"""
	# response, _ = session.interact(ai_prompt, stream=False)
	# if response:
	# 	response_content = response['content'][0]['text']
	# 	tech_que = (
	# 			response_content.replace("```json", "")
	# 			.replace("```", "")
	# 			.strip()
	# 		)
	job_opeing.custom_technical_questions = ai_response.replace("```json", "").replace("```", "").strip()
	job_opeing.save()
	return "Technical Questions Updated Successfully"

# ==================== Generate Booleans ==========================

@frappe.whitelist()
def generate_booleans(boolean_prompt, additional_instructions, session_id, technical_questions, rejection_reason=None):
	if not session_id:
		return {"error": "Create JRSS First to Generate Technical Questions."}
	
	session = otto.load(session_id)
	model = otto.get_model(size="Small", provider=ai_provider)
	ai_prompt = boolean_prompt + "\n" + additional_instructions + "\n" + " and do not give extra details which are not asked. (Refer JRSS Perviously Generated & technical questions {0} and rejectd reasons of past candidate are {1})".format(technical_questions, rejection_reason or 'Not require')
	stream = session.interact(ai_prompt, stream=True)

	try:
		for chunk in stream:
			frappe.realtime.publish_realtime(
				"stream-llm",
				{
					"llm": model,
					"chunk": chunk,
				},
				user=frappe.session.user,
			)
	except Exception as e:
		return {"error": str(e)}

	if stream.failure_reason:
		return {"error": stream.failure_reason}

	if stream.item is None:
		return {
			"message": "success",
		}

	return {
		"message": "success",
		"item": stream.item,
	}
	

@frappe.whitelist()
def fill_booleans(docname, ai_response):
	job_opeing = frappe.get_doc("Job Opening", docname)
	# session_id = job_opeing.custom_session_id

	# session = otto.load(session_id)
	# ai_prompt = """Give me Last generated Boolean only(no headings or other details)"""
	# response, _ = session.interact(ai_prompt, stream=False)
	# if response:
	# 	response_content = response['content'][0]['text']
	job_opeing.custom_candidate_boolean = ai_response
	job_opeing.save()
	return "Boolean Generated"
	
# ==================== Generate Screening Questions ==========================

@frappe.whitelist()
def generate_screening_questions(screening_question_prompt, additional_instructions, session_id, technical_questions, rejection_reason=None):
	if not session_id:
		return {"error": "Create JRSS First to Generate Screening Question."}
	
	session = otto.load(session_id)
	model = otto.get_model(size="Small", provider=ai_provider)
	ai_prompt = screening_question_prompt + "\n" + additional_instructions + "\n" + "give response in html and do not give extra details which are not asked. (Refer JRSS Perviously Generated & technical questions {0} and rejectd reasons of past candidate are {1})".format(technical_questions, rejection_reason or 'Not require')
	stream = session.interact(ai_prompt, stream=True)

	try:
		for chunk in stream:
			frappe.realtime.publish_realtime(
				"stream-llm",
				{
					"llm": model,
					"chunk": chunk,
				},
				user=frappe.session.user,
			)
	except Exception as e:
		return {"error": str(e)}

	if stream.failure_reason:
		return {"error": stream.failure_reason}

	if stream.item is None:
		return {
			"message": "success",
		}

	return {
		"message": "success",
		"item": stream.item,
	}
	

@frappe.whitelist()
def fill_screening_questions(docname, ai_response):
	job_opeing = frappe.get_doc("Job Opening", docname)
	# session_id = job_opeing.custom_session_id

	# session = otto.load(session_id)
	# ai_prompt = """Give me Last generated Screening Questions only(no headings or other details) in simple text"""
	# response, _ = session.interact(ai_prompt, stream=False)
	# if response:
	# 	response_content = response['content'][0]['text']
	job_opeing.custom_screening_questions = ai_response.replace("<ol>", "").replace("</ol>", "").replace("<li>", "").replace("</li>", "")
	job_opeing.save()
	return "Screening Questions Generated"


# ==================== Job Applicant ==========================

# ==================== Analyse CV ==========================

@frappe.whitelist()
def analyse_cv(cv_file,analyse_cv_prompt,additional_instructions,session_id=None, job_opening=None):

	jd=""
	jrss=[]
	technical_questions=""
	rejection_reasons=""
	if job_opening:
		job_opening = frappe.get_doc("Job Opening", job_opening)
		jd = job_opening.job_title
		technical_questions = job_opening.custom_technical_questions
		rejection_reasons = job_opening.custom_rejection_reason

		if len(job_opening.custom_jrss_mandatory_skills) > 0:
			for jrss_skill in job_opening.custom_jrss_mandatory_skills:
				jrss.append(jrss_skill.skill)

		if len(job_opening.custom_jrss_optional_skills) > 0:
			for jrss_skill in job_opening.custom_jrss_optional_skills:
				jrss.append(jrss_skill.skill)


	if not cv_file.lower().endswith(".pdf"):
		return {"error": "LLM Only Supports PDF Files"}
	
	model = otto.get_model(size="Small", provider=ai_provider)
	ai_prompt = analyse_cv_prompt + " " + additional_instructions + "/n" + "References - JD : {0}, JRSS: {1} , technical questions : {2}, rejection reasons : {3}".format(jd, jrss, technical_questions, rejection_reasons) +" give me output in HTML Format and do not give extra details which are not asked."

	if not session_id:
		session = otto.new(
			model=model,
			instruction="Analyse CV",
		)
		session_id = session.id

	else:
		session = otto.load(session_id)

	stream = session.interact([content.file(cv_file, name="cv_file.pdf") ,ai_prompt], stream=True)
	
	try:
		for chunk in stream:
			frappe.realtime.publish_realtime(
				"stream-llm",
				{
					"llm": model,
					"chunk": chunk,
				},
				user=frappe.session.user,
			)
	except Exception as e:
		return {"error": str(e)}

	if stream.failure_reason:
		return {"error": stream.failure_reason}

	if stream.item is None:
		return {
			"message": "success",
		}

	return {
		"message": "success",
		"item": stream.item,
		"session_id": session_id,
	}

@frappe.whitelist()
def fill_cv_analysation(docname, session_id, ai_response):
	job_applicant = frappe.get_doc("Job Applicant", docname)

	# session = otto.load(session_id)
	# ai_prompt = """Give me Last generated CV Enalysis only(no headings or other details)"""
	# response, _ = session.interact(ai_prompt, stream=False)
	# if response:
	# 	response_content = response['content'][0]['text']
	# 	cleaned_str = (
	# 			response_content.replace("```html", "")
	# 			.replace("```", "")
	# 		)
	job_applicant.custom_analyse_cv = ai_response.replace("```html", "").replace("```", "")
	job_applicant.custom_session_id = session_id
	job_applicant.save()
	return "Analyse CV Generated"
	
@frappe.whitelist()
def evaluate_cv(screening_call_transcript, evaluate_candidate_prompt, additional_instructions, session_id):
	if not session_id:
		return {"error": "Analyse Candidate CV First to Evaluate CV."}
	
	if not screening_call_transcript.lower().endswith(".pdf"):
		return {"error": "LLM Only Supports PDF Files"}

	session = otto.load(session_id)
	model = otto.get_model(size="Small", provider=ai_provider)
	# respose_format = """Format: Create an HTML table with EXACTLY the following 4 columns: 1. Criteria (JRSS Skill, Technical Questions, JD Title Discrepancy),  2. JD (jd_name) / JRSS / Technical Questions  3. Candidate CV Details  4. Evaluation (In less then 100 characters, (background-color for Evaluation column only)), not add extra text in header"""
	respose_format = """Format: Create an HTML table with EXACTLY the following 2 columns header: 1. Section,  2. Details, do not add extra text in header"""

	ai_prompt = evaluate_candidate_prompt + "\n" + additional_instructions + "\n" + " and do not give extra details which are not asked.(Refer Previously Attached CV)." + respose_format + "Give output in HTML Format."


	stream = session.interact([content.file(screening_call_transcript, name="cv_file.pdf") ,ai_prompt], stream=True)

	try:
		for chunk in stream:
			frappe.realtime.publish_realtime(
				"stream-llm",
				{
					"llm": model,
					"chunk": chunk,
				},
				user=frappe.session.user,
			)
	except Exception as e:
		return {"error": str(e)}

	if stream.failure_reason:
		return {"error": stream.failure_reason}

	if stream.item is None:
		return {
			"message": "success",
		}

	return {
		"message": "success",
		"item": stream.item,
	}

@frappe.whitelist()
def fill_evaluate_candidate(session_id, row_name, ai_response):
	# session = otto.load(session_id)
	# ai_prompt = """Give me Latest generated Evaluation of CV in HTML"""
	# response, _ = session.interact(ai_prompt, stream=False)
	# if response:
	# 	response_content = response['content'][0]['text']
	# 	cleaned_str = (
	# 			response_content.replace("```html", "")
	# 			.replace("```", "")
	# 		)
	frappe.db.set_value("Evaluate Candidate Details CT", row_name, "evaluate_candidate", ai_response.replace("```html", "").replace("```", ""))
		# row.evaluate_candidate = response_content
	return "Evaluate Candidate Generated"
	
@frappe.whitelist()
def extract_details_from_candidate_cv(resume_attachment, session_id=None):
	# print("============extract_details_from_candidate_cv=================")
	if not resume_attachment.lower().endswith(".pdf"):
		return {"error": "LLM Only Supports PDF Files"}
	
	model = otto.get_model(size="Small", provider=ai_provider)
	ai_prompt = """ Extract Applicant Name, Email Address, Mobile Number, Current City In Following Format Only:
					example: 
					{
					"applicant_name": "Applicant Name",
					"email_id": "Email Address",
					"phone_number": "Mobile Number" (only Number Digit Country Code Note Require),
					"current_city": "Current City"
					} 
					"""
	
	if not session_id:
		session = otto.new(
		model=model,
		instruction="Extract Candidate Details From CV",
		)
		session_id = session.id
	
	else:
		session = otto.load(session_id)

	response, _ = session.interact([content.file(resume_attachment, name="cv.pdf") ,ai_prompt], stream=False)

	if response:
		response_content = response['content'][0]['text']
		candidate_details = parse_json_string(response_content)
		return{
			"applicant_name" : candidate_details.get("applicant_name"),
			"email_id": candidate_details.get("email_id"),
			"phone_number": candidate_details.get("phone_number"),
			"current_city": candidate_details.get("current_city"),
			"session_id": session_id
		}	


@frappe.whitelist()
def open_pdf(doctype, docname, print_format):
	pdf = get_pdf_link(doctype, docname, print_format, no_letterhead=0)
	pdf = pdf + "&letterhead=Npro"
	print(pdf)
	return pdf

# ==================== Utility Function to parse JSON string ====================
	
def parse_json_string(raw_str):

	# Remove code block markers
	cleaned_str = (
		raw_str.replace("```json", "")
		.replace("```", "")
		.strip()
	)

	try:
		data = json.loads(cleaned_str)
	except json.JSONDecodeError as e:
		frappe.throw(f"Invalid JSON format: {e}")

	return data