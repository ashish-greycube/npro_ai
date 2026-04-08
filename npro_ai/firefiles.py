import frappe
import requests
from frappe.utils import get_link_to_form
import json

settings = frappe.get_single("Npro AI Settings")

FIREFLIES_API_KEY = settings.get_password("firefiles_api_key") or ""
ENDPOINT = "https://api.fireflies.ai/graphql"
HEADERS = {"Authorization": f"Bearer {FIREFLIES_API_KEY}", "Content-Type": "application/json"}

@frappe.whitelist()
def upload_transcription(docname, audio_url):
		# check if file is public or private:
		file_doc = frappe.get_doc("File", {"file_url": audio_url})
		is_private_file = False
		if file_doc.is_private:
				file_doc.is_private = 0
				is_private_file = True
				file_doc.save(ignore_permissions=True)

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

		# Using 'docname' as the reference ID so we can find it later
		variables = {
				"input": {
						"url": audio_url,   # "https://test15.greycube.in/files/narendrakumar.mp3", <-- For Testing only
						"title": audio_title,
						"client_reference_id": docname 
				}
		}

		try:
			response = requests.post(ENDPOINT, json={'query': mutation, 'variables': variables}, headers=HEADERS)
			if response.status_code == 200:
				response_json = response.json()
				# response = {'data': {'uploadAudio': {'success': True, 'message': 'Uploaded audio has been queued for processing.'}}} ========response_json==========

				# print(response_json, "========response_json==========")
				if response_json.get('data', {}).get('uploadAudio', {}).get('success'):
					frappe.db.set_value("Evaluate Candidate Details CT", docname, "transcript_status", "Processing")
					frappe.db.set_value("Evaluate Candidate Details CT", docname, "file_title", audio_title)
					frappe.msgprint("Audio File uploading..., it may take few mintues to get the transcript.", alert=True)

					if is_private_file:
						file_doc.is_private = 1
						file_doc.save(ignore_permissions=True)
				else:
					frappe.db.set_value("Evaluate Candidate Details CT", docname, "transcript_status", "Upload Failed")
					log = frappe.log_error("Fireflies API Error: {0}".format(response_json.get('message')), "Fireflies Upload Failed")
					frappe.msgprint("Fireflies API Error: {0}".format(get_link_to_form("Error Log", log.name)), alert=True)
			else:
					frappe.db.set_value("Evaluate Candidate Details CT", docname, "transcript_status", "Upload Failed")
					log = frappe.log_error("HTTP Error {0}: {1}".format(response.status_code, response.text), "Fireflies Upload Failed")
					frappe.msgprint("HTTP Error {0}: {1}".format(response.status_code, get_link_to_form(log.name)), alert=True)
			
			return response.json()
		except Exception as e:
				error = frappe.get_traceback()
				log = frappe.log_error(title="Fireflies Upload Error", message=error)
				frappe.msgprint("Fireflies Upload Error: {0}".format(get_link_to_form("Error Log", log.name)), alert=True)
				return {"error": str(e)}

### run scheduler in every 15min to get transcripts which are in processing state and update the transcript text in the doctype once the status is completed.
@frappe.whitelist()
def get_transcript():
	uploaded_audios = frappe.get_all("Evaluate Candidate Details CT", filters={"transcript_status": "Processing"}, fields=["name", "file_title", "parenttype", "parent"])
	# print(uploaded_audios, "======uploaded_audios=====")
	if len(uploaded_audios) > 0:
		for evaluate_doc in uploaded_audios:
			docname = evaluate_doc.name

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
					continue

				transcripts_found = res.json().get("data", {}).get("transcripts", [])

				if len(transcripts_found) == 0:
					continue
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
							break

				parent_doc = frappe.get_doc(evaluate_doc.parenttype, evaluate_doc.parent)
				parent_doc.flags.ignore_mandatory = True
				parent_doc.save(ignore_permissions=True)
				parent_doc.reload()

				# frappe.db.commit() # Ensure changes are saved before the next API call
							

			except Exception:
				error = frappe.get_traceback()
				frappe.log_error(title="Fireflies Transcript Fetch Error", message=error)
				continue

	return "Process completed."