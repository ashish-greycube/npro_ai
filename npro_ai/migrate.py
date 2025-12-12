import frappe

def after_migrate():
    fill_prompt_if_empty_in_settings()


def fill_prompt_if_empty_in_settings():
    ai_doc = frappe.get_doc("Npro AI Settings")
    
    if not ai_doc.generate_jrss_prompt or ai_doc.generate_jrss_prompt == "":
        ai_doc.generate_jrss_prompt = "Based on the uploaded JD, create a JRSS - there should be 4 mandatory skills and 4 optional skills. There should be one extra skill as well - they should show stability in their career, not jumping from job to job, and no long gaps in between jobs."
        print("---Add Generate JRSS Prompt---")

    if not ai_doc.get_technical_questions_prompt or ai_doc.get_technical_questions_prompt == "":
        ai_doc.get_technical_questions_prompt = "Based on the JD and JRSS, can you give me 5 technical questions that should be asked to the candidates (input for the interviewer) during the second interview round - the technical interview"
        print("---Add Technical Questions Prompt---")

    if not ai_doc.generate_boolean_prompt or ai_doc.generate_boolean_prompt == "":
        ai_doc.generate_boolean_prompt = "Based on the uploaded JD, JRSS, technical questions, and rejected reasons of past candidates, generate a Boolean to search for candidates on Naukri. Keep it under 500 characters"
        print("---Add Generate Boolean Prompt---")

    if not ai_doc.generate_screening_questions_prompt or ai_doc.generate_screening_questions_prompt == "":
        ai_doc.generate_screening_questions_prompt = "Based on  the JD, JRSS, technical interview questions, and past CV reject reasons, give me 3 technical screening questions to ask during the first call with the candidate. This should help me decide if we should send the candidate CV for client screening or not."
        print("---Add Generate Screening Questions Prompt---")

    if not ai_doc.analyse_cv or ai_doc.analyse_cv == "":
        ai_doc.analyse_cv = "Based on the candidate’s CV, evaluate against the JD and JRSS in a matrix format. Indicate if we should call the candidate for screening or not. Take into account the JD, JRSS, technical questions, and past CV rejection reasons."
        print("---Add Analyse CV Prompt---")

    if not ai_doc.evaluate_candidate or ai_doc.evaluate_candidate == "":
        ai_doc.evaluate_candidate = "Based on the candidate’s screening call transcript, evaluate the candidate. Include a section on their Pros, Cons, Screening Q&A (list down the question asked, summary of answer, and analysis of answer), and Overall Recommendation"
        print("---Add Evaluate Candidates Prompt---")

    ai_doc.save(ignore_permissions=True)