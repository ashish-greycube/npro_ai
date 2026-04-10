import frappe
import requests
from frappe.utils import get_link_to_form
import json
import time
import urllib.parse

settings = frappe.get_single("Npro AI Settings")

FIREFLIES_API_KEY = settings.get_password("firefiles_api_key") or ""
ENDPOINT = "https://api.fireflies.ai/graphql"
HEADERS = {"Authorization": f"Bearer {FIREFLIES_API_KEY}", "Content-Type": "application/json"}

@frappe.whitelist()
def upload_audio_file(docname, audio_url):
		if not audio_url.lower().endswith((".mp3", ".mp4", ".wav", ".m4a", ".ogg")):
			frappe.throw("Unsupported file format. Please upload an audio file (mp3, mp4, wav, m4a, ogg).")
			return {"error": "Unsupported file format."}

		# check if file is public or private:
		file_doc = frappe.get_doc("File", {"file_url": audio_url})

		is_private_file = False
		public_file_name = None

		if file_doc.is_private:
			public_file_name, public_file_url = create_private_file_copy(file_doc.name)
			audio_url = public_file_url
			if not public_file_url:
				frappe.log_error(title="Fireflies Upload Error", message="Failed to create public copy of the file for upload.")
				frappe.db.set_value("Evaluate Candidate Details CT", docname, "transcript_status", "Upload Failed")
				return {"error": "Failed to create public copy of the file for upload."}
			else:
				is_private_file = True
		
		if audio_url:
			if not frappe.db.exists("File", {"file_url": audio_url}):
				log = frappe.log_error(title="Fireflies Upload Error", message="File URL does not exist in the system: {0}".format(audio_url))
				frappe.msgprint("File URL does not exist in the system: {0}. Error Log: {1}".format(audio_url, get_link_to_form("Error Log", log.name)))
				if is_private_file:
					delete_public_file_copy(public_file_name)  # Clean up the public copy
				return {"error": "File URL does not exist in the system."}
			else:
				encoded_url = urllib.parse.quote(audio_url)
				full_url = frappe.utils.get_url(encoded_url)

				"""
				Step 1: Upload and tag with 'client_reference_id'
				"""
				mutation = """
				mutation($input: AudioUploadInput) {
					uploadAudio(input: $input) {
						success
						message
					}
				}
				"""

				audio_title = "{0}-{1}".format(file_doc.file_name, docname)
				# audio_title = "Transcript for {0}".format("testing narendrakumar.mp3")  # For Testing only

				variables = {
						"input": {
								"url": full_url,   # "https://test15.greycube.in/files/narendrakumar.mp3", <-- For Testing only
								"title": audio_title,
								"client_reference_id": docname 
						}
				}

				try:
					response = requests.post(ENDPOINT, json={'query': mutation, 'variables': variables}, headers=HEADERS)
					response.raise_for_status() # Raises HTTPError for 4xx/5xx codes
					response_json = response.json()
					data = response_json.get('data') or {}
					upload_result = data.get('uploadAudio')
					errors = response_json.get('errors')

					if upload_result and upload_result.get('success'):
						frappe.db.set_value("Evaluate Candidate Details CT", docname, "transcript_status", "Processing")
						frappe.db.set_value("Evaluate Candidate Details CT", docname, "file_title", audio_title)
						frappe.msgprint("Audio File uploading..., it may take few mintues to get the transcript (Maximun 30min).", alert=True)
					else:
						# Handle GraphQL errors or business logic failure
						error_msg = errors[0].get('message') if errors else "Unknown Fireflies Error"
						if upload_result and upload_result.get('message'):
							error_msg = upload_result.get('message')

						frappe.db.set_value("Evaluate Candidate Details CT", docname, "transcript_status", "Upload Failed")
						log = frappe.log_error("Fireflies API Error: {0}".format(error_msg), "Fireflies Upload Failed")
						frappe.msgprint("Fireflies API Error: {0}".format(get_link_to_form("Error Log", log.name)), alert=True)

					parent_doc_name = frappe.db.get_value("Evaluate Candidate Details CT", docname, "parent")
					parent_doc = frappe.get_doc("Job Applicant", parent_doc_name)
					parent_doc.flags.ignore_mandatory = True
					parent_doc.save(ignore_permissions=True)
					parent_doc.reload()

					if is_private_file:
						delete_public_file_copy(public_file_name)  # Clean up the public copy after upload
					
					return response.json()
				except Exception as e:
					error = frappe.get_traceback()
					log = frappe.log_error(title="Fireflies Upload Error", message=error)
					frappe.msgprint("Fireflies Upload Error: {0}".format(get_link_to_form("Error Log", log.name)), alert=True)

					if is_private_file:
						delete_public_file_copy(public_file_name) # Clean up the public copy in case of error as well

					return {"error": str(e)}

@frappe.whitelist()
def get_transcript(docname, audio_url):
	if not audio_url.lower().endswith((".mp3", ".mp4", ".wav", ".m4a", ".ogg")):
		frappe.throw("Unsupported file format. Please upload an audio file (mp3, mp4, wav, m4a, ogg).")
		return {"error": "Unsupported file format."}
	
	evaluate_doc = frappe.get_doc("Evaluate Candidate Details CT", docname)
	audio_title = evaluate_doc.file_title
	# audio_title = "Transcript for {0}".format("testing narendrakumar.mp3")  # For Testing only
	try:
		search_query = """
					query Transcripts($keyword: String, $userId: String) {
					transcripts(keyword: $keyword, scope: "title", user_id: $userId) {
						title
						id
					}
					}
				"""
		
		# print("========searchhhh====")

		res = requests.post(ENDPOINT, headers=HEADERS, json={'query': search_query, 'variables': {'keyword': audio_title}})
		# print(res.json(), "========search transcripts response========")
		
		if res.status_code != 200:
			frappe.db.set_value("Evaluate Candidate Details CT", docname, "transcript_status", "Failed to Fetch Transcript")
			frappe.log_error(title="Fireflies API Error: {0}".format(res.text), message="Failed to search transcripts for {0}".format(audio_title))

		transcripts_found = res.json().get("data", {}).get("transcripts", [])
		# print(transcripts_found, "========transcripts_found=======")

		if not transcripts_found:
			frappe.msgprint("Transcript is still processing. Try again after few minutes", alert=True)
		else:
			for transcript in transcripts_found:
				if transcript.get("title") == audio_title:
					# print("========title match=====", transcript)
					transcript_id = transcript.get("id")
					content_query = """
						query Transcript($id: String!) {
							transcript(id: $id) {
								sentences {
									speaker_id
									text
								}
							}
						}
						"""

					content_res = requests.post(ENDPOINT , headers=HEADERS, json={'query': content_query, 'variables': {'id': transcript_id}})
					if content_res.status_code != 200:
						frappe.db.set_value("Evaluate Candidate Details CT", docname, "transcript_status", "Failed to Fetch Transcript")
						frappe.log_error(title="Fireflies API Error: {0}".format(content_res.text), message="Failed to fetch transcript content for {0}".format(audio_title))
						continue

					# print(content_res, "========final transcript response========")
					sentences = content_res.json().get("data", {}).get("transcript", {}).get("sentences", [])
					full_transcript = ""
					for s in sentences:
						speaker_name = "Speaker {0}".format(s.get("speaker_id"))
						
						full_transcript += "{0} : {1}\n".format(speaker_name, s.get("text"))
			
					frappe.db.set_value("Evaluate Candidate Details CT", docname, {
							"transcript_id": transcript_id,
							"transcript": full_transcript,
							"transcript_status": "Completed"
					})
					frappe.msgprint("Transcript fetched successfully.", alert=True)
					break

		parent_doc = frappe.get_doc(evaluate_doc.parenttype, evaluate_doc.parent)
		parent_doc.flags.ignore_mandatory = True
		parent_doc.save(ignore_permissions=True)
		parent_doc.reload()

		# frappe.db.commit() # Ensure changes are saved before the next API call
					

	except Exception:
		error = frappe.get_traceback()
		frappe.log_error(title="Fireflies Transcript Fetch Error", message=error)

	return "Process completed."


def create_private_file_copy(file_name):
	file_doc = frappe.get_doc("File", file_name)
	new_doc = frappe.new_doc("File")
	new_doc.is_private = 0
	new_doc.file_name = "public_" + file_doc.file_name
	new_doc.content=file_doc.get_content()
	new_doc.save()
	return new_doc.name, new_doc.file_url


def delete_public_file_copy(public_file_name):
	if frappe.db.exists("File", public_file_name):
		frappe.delete_doc("File", public_file_name)  # Clean up the public copy after upload