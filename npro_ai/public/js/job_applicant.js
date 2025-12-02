frappe.ui.form.on("Job Applicant", {
    refresh: function (frm) {
        if (!frm.is_new() && frm.doc.resume_attachment) {
            frm.add_custom_button(__("Analyse CV"), () => {
                analyse_cv_dialog(frm)
            }, __("Ask AI"))

            if(frm.doc.custom_analyse_cv && frm.doc.custom_analyse_cv != '<div class="ql-editor read-mode"><p><br></p></div>' && frm.doc.custom_evaluate_candidate_details.length > 0){
                frm.add_custom_button(__("Evaluate Candidate"), () => {
                    find_valid_evaluate_candidate_row(frm)
                }, __("Ask AI"))
            }
        }

        if (frm.doc.custom_session_id) {
            frm.add_web_link(
                `/app/view-otto-session/${frm.doc.custom_session_id}`,
                __("Open in Session Viewer")
            );
        }
    },
    resume_attachment: function(frm){
        if (frm.doc.resume_attachment){
            
            frappe.call({
                method: "npro_ai.api.check_attached_file_format",
                args: {"file":  frm.doc.resume_attachment},
                callback: function (r) {
                    if (r.message) {
                        frm.reload_doc()
                    }
                    else {
                        frappe.call({
                            method: "npro_ai.api.extract_details_from_candidate_cv",
                            args: {
                                "resume_attachment": frm.doc.resume_attachment,
                                "session_id": frm.doc.custom_session_id || undefined
                            },
                            freeze: true,
                            freeze_message: __("Extracting Candidate Details from CV..."),
                            callback: function ({ message }) {
                                // console.log("==============message==========", message)
                                frm.set_value("applicant_name", message.applicant_name)
                                frm.set_value("email_id", message.email_id)
                                frm.set_value("phone_number", message.phone_number)
                                frm.set_value("current_city_cf", message.current_city)
                                frm.set_value("custom_session_id", message.session_id)
                            }
                        })
                    }
                }
            })
        }
    },

    custom_print_analyse_cv: function(frm){
        if (!frm.is_new()){
            frappe.call({
            method: "npro_ai.api.open_pdf",
            args: {
                "doctype": frm.doc.doctype,
                "docname": frm.doc.name,
                "print_format": "Analyse CV Print"
            },
            callback: function (res) {
                // console.log(res.message)
                var w = window.open(
                    res.message
                );
            }
        })
        }
    }
})

frappe.ui.form.on("Evaluate Candidate Details CT", {
    screening_call_transcript: function(frm, cdt, cdn){
        let row = locals[cdt][cdn]
        if (row.screening_call_transcript){
            frappe.call({
                method: "npro_ai.api.check_attached_file_format",
                args: {
                    "file": row.screening_call_transcript
                },
                callback: function (r) {
                    if (r.message) {
                        frm.reload_doc()
                    }
                }
            })
        }
    },
    print: function(frm, cdt, cdn){
        if (frm.is_dirty()) {
            frappe.throw("Please Save Form To Open PDF")
        }

        frappe.call({
            method: "npro_ai.api.open_pdf",
            args: {
                "doctype": cdt,
                "docname": cdn,
                "print_format": "Evaluate Candidate Print"
            },
            callback: function (res) {
                // console.log(res.message)
                var w = window.open(
                    res.message
                );
            }
        })
    }
})


let analyse_cv_dialog = function (frm) {

    if (frm.doc.custom_analyse_cv && frm.doc.custom_analyse_cv != '<div class="ql-editor read-mode"><p><br></p></div>') {
        frm.scroll_to_field("custom_analyse_cv")
    }
    else {
        let analyse_cv_prompt = ""
        frappe.db.get_single_value("Npro AI Settings", "analyse_cv")
            .then(analyse_cv => {
                if (analyse_cv) {
                    analyse_cv_prompt = analyse_cv

                    const id = Math.random().toString(36).substring(2, 15);
                    let dialog = undefined;

                    let dialog_field = [
                        {
                            fieldtype: "Data",
                            fieldname: "analyse_cv_prompt",
                            label: __("Analyse CV Prompt"),
                            read_only: 1,
                            default: analyse_cv_prompt
                        },
                        {
                            fieldtype: "Data",
                            fieldname: "additional_instructions",
                            label: __("Additional Instructions"),
                            read_only: 0,
                        },
                        {
                            fieldtype: "Button",
                            fieldname: "analyse_cv_button",
                            label: __("Analyse CV"),
                            click: function () {
                                getLLMResponseUI(id);
                                dialog.get_primary_btn().prop("disabled", true);
                                ask_to_analyse_cv(dialog, id)
                            }
                        },
                        {
                            fieldtype: "Data",
                            fieldname: "session_id",
                            label: __("Session ID"),
                            read_only: 1,
                            hidden: 1,
                            default: frm.doc.custom_session_id || ""
                        },
                        {
                            fieldname: "response_section",
                            fieldtype: "HTML",
                            options: createLLMResponseHTML(id),
                        },
                        {
                            fieldtype: "Check",
                            fieldname: "response_generated",
                            label: "Response Generated",
                            hidden: 1,
                            default: 0
                        }
                    ]

                    dialog = new frappe.ui.Dialog({
                        title: __("Analyse CV"),
                        fields: dialog_field,
                        primary_action_label: 'Analyse CV',
                        primary_action: function (values) {
                            console.log(values, "-----values")
                            if (values.response_generated == 1) {
                                frappe.call({
                                    method: "npro_ai.api.fill_cv_analysation",
                                    args: {
                                        "docname": frm.doc.name,
                                        "session_id": values.session_id
                                    },
                                    freeze: true,
                                    freeze_message: __("Adding CV Analsation..."),
                                    callback: function (r) {
                                        if (r.message) {
                                            frappe.show_alert(__('Analyse CV For Candidate are Generated and Added to the Job Applicant Successfully.'), 5);
                                        }
                                        frm.reload_doc();
                                    }
                                })
                                dialog.hide();
                            }
                        }
                    })

                    dialog.show();
                }
                else {
                    frappe.throw(__("Please Set Analyse CV Prompt In Npro AI Settings Doc"))
                }
            })
    }
}

let ask_to_analyse_cv = function (dialog, id) {
    const d = dialog.get_values();
    const ui = getUIElements(id);

    resetUI(ui);
    handleStreaming(ui, "stream-llm");

    frappe.call({
        method: "npro_ai.api.analyse_cv",
        args: {
            cv_file: frm.doc.resume_attachment,
            analyse_cv_prompt: d.analyse_cv_prompt || "",
            additional_instructions: d.additional_instructions || "",
            session_id: d.session_id || undefined,
            job_opening: frm.doc.job_title || undefined,
        },
        callback({ message }) {
            dialog.set_value("session_id", message.session_id);
            dialog.set_value("additional_instructions", "");
            dialog.set_value("response_generated", 1)

            dialog.set_df_property("additional_instructions", "label", "Re Define Instructions");
            dialog.set_df_property("analyse_cv_button", "label", "Regenerate Analyse CV");
            frm.set_value("custom_session_id", message.session_id)

            dialog.get_primary_btn().prop("disabled", false);
            updateFinalUI(ui, message);
        },
    });

}


let find_valid_evaluate_candidate_row = function(frm){
    console.log("find_valid_evaluate_candidate_row")
    frm.doc.custom_evaluate_candidate_details.forEach(row => {
        if (!row.evaluate_candidate || row.evaluate_candidate == '<div class="ql-editor read-mode"><p><br></p></div>'){
            evaluate_candidate_dialog(frm, row)
        }
        else if (row.idx == frm.doc.custom_evaluate_candidate_details.length && (row.evaluate_candidate || row.evaluate_candidate != '<div class="ql-editor read-mode"><p><br></p></div>') ){
            frm.scroll_to_field("custom_evaluate_candidate_details")
        }
    })
}

let evaluate_candidate_dialog = function(frm, row){
    if (!row.screening_call_transcript){
        frappe.throw(__("Row {0} : Please Attach Screening Call Transcript First.",[row.idx]));
    }
    else{
        let evaluate_candidate_prompt = ""

        frappe.db.get_single_value("Npro AI Settings", "evaluate_candidate")
            .then(evaluate_candidate => {
                if (evaluate_candidate) {
                    evaluate_candidate_prompt = evaluate_candidate

                    const id = Math.random().toString(36).substring(2, 15);
                    let dialog = undefined;

                    let dialog_field = [
                        {
                            fieldtype: "Data",
                            fieldname: "row_no",
                            label: __("<b>Row No</b>"),
                            read_only: 1,
                            default: row.idx
                        },
                        {
                            fieldtype: "Data",
                            fieldname: "evaluate_candidate_prompt",
                            label: __("Evaluate Candidate Prompt"),
                            read_only: 1,
                            default: evaluate_candidate_prompt
                        },
                        {
                            fieldtype: "Data",
                            fieldname: "additional_instructions",
                            label: __("Additional Instructions"),
                            read_only: 0,
                        },
                        {
                            fieldtype: "Button",
                            fieldname: "evaluate_candidate_button",
                            label: __("Evaluate Candidate"),
                            click: function () {
                                getLLMResponseUI(id);
                                dialog.get_primary_btn().prop("disabled", true);
                                ask_to_evaluate_candidate(dialog, id, row.screening_call_transcript)
                            }
                        },
                        {
                            fieldname: "response_section",
                            fieldtype: "HTML",
                            options: createLLMResponseHTML(id),
                        },
                        {
                            fieldtype: "Check",
                            fieldname: "response_generated",
                            label: "Response Generated",
                            hidden: 1,
                            default: 0
                        }
                    ]

                    dialog = new frappe.ui.Dialog({
                        title: __("Evaluate Candidate"),
                        fields: dialog_field,
                        primary_action_label: 'Evaluate Candidate',
                        primary_action: function (values) {
                            console.log(values, "-----values")
                            if (values.response_generated == 1) {
                                frappe.call({
                                    method: "npro_ai.api.fill_evaluate_candidate",
                                    args: {
                                        "session_id": frm.doc.custom_session_id,
                                        "row_name": row.name
                                    },
                                    freeze: true,
                                    freeze_message: __("Adding Evaluate Candidate Details..."),
                                    callback: function (r) {
                                        if (r.message) {
                                            // console.log(r.message, "=========r.message========")
                                            console.log(row.name, "-------------row.name---------")
                                            // frappe.model.set_value('Evaluate Candidate Details CT', row.name, 'evaluate_candidate',r.message)
                                            // row.evaluate_candidate = r.message
                                            frm.save()
                                            frappe.show_alert(__('Evaluate Candidate Details are Generated and Added to the Job Applicant Successfully.'), 5);
                                        }
                                        frm.reload_doc();
                                    }
                                })
                                dialog.hide();
                            }
                        }
                    })
                    dialog.show();

                }
                else{
                    frappe.throw(__("Please Set Evaluate Candidate Prompt In Npro AI Settings Doc"))
                }
            })
    }
}

let ask_to_evaluate_candidate = function (dialog, id, file_name) {
    const d = dialog.get_values();
    const ui = getUIElements(id);

    resetUI(ui);
    handleStreaming(ui, "stream-llm");

    frappe.call({
        method: "npro_ai.api.evaluate_cv",
        args: {
            screening_call_transcript: file_name,
            evaluate_candidate_prompt: d.evaluate_candidate_prompt || "",
            additional_instructions: d.additional_instructions || "",
            session_id: frm.doc.custom_session_id || undefined,
        },
        callback({ message }) {
            dialog.set_value("session_id", message.session_id);
            dialog.set_value("additional_instructions", "");
            dialog.set_value("response_generated", 1)

            dialog.set_df_property("additional_instructions", "label", "Re Define Instructions");
            dialog.set_df_property("evaluate_candidate_button", "label", "Regenerate Evaluate CV");

            dialog.get_primary_btn().prop("disabled", false);
            updateFinalUI(ui, message);
        },
    });

}


// ------------- General LLM UI Handling Functions -------------

// -------------------------------------
// create all UI Elements
// -------------------------------------

function createLLMResponseHTML(id) {
  return `
    <div id="llm-response-area-${id}" 
          style="margin-top: var(--padding-md); padding: var(--padding-sm); border-radius: var(--border-radius); background-color: var(--gray-100); max-height: 400px; overflow-y: auto; display: none;">
      <div id="llm-processing-response-${id}" title="Response content" style="display: none; color: var(--gray-500); font-size: var(--text-sm);">
        Processing query...
      </div>
      <div id="llm-thinking-response-${id}" title="Thinking response" style="font-style: italic; color: var(--gray-700); display: none;"></div>
      <div id="llm-text-response-${id}" title="Text response" style="display: none;"></div>
      <div id="llm-tool-use-response-${id}" title="Tool use response" style="display: none;"></div>
      <div id="llm-stats-response-${id}" title="Response stats" style="display: none; font-size: var(--text-xs); margin-bottom: 0;"></div>
      <div id="llm-error-response-${id}" title="Response error" style="display: none; font-size: var(--text-xs); margin-bottom: 0; color: var(--red-500);"></div>
    </div>
    `;
}

// -------------------------------------
// Get all UI Elements
// -------------------------------------

function getLLMResponseUI(id) {
  const responseArea = document.getElementById(`llm-response-area-${id}`);
  const processingResponse = document.getElementById(`llm-processing-response-${id}`);

  if (responseArea) {
    responseArea.style.display = "flex";
    responseArea.style.flexDirection = "column";
    responseArea.style.gap = "var(--padding-md)";
  }

  if (processingResponse) {
    processingResponse.style.display = "block";
  }

  return { responseArea, processingResponse };
}

// -------------------------------------
// 1. Collect all UI Elements
// -------------------------------------

function getUIElements(id) {
  return {
    responseArea: document.getElementById(`llm-response-area-${id}`),
    processing: document.getElementById(`llm-processing-response-${id}`),
    text: document.getElementById(`llm-text-response-${id}`),
    thinking: document.getElementById(`llm-thinking-response-${id}`),
    tool: document.getElementById(`llm-tool-use-response-${id}`),
    stats: document.getElementById(`llm-stats-response-${id}`),
    error: document.getElementById(`llm-error-response-${id}`),
  };
}

// -------------------------------------
// 2. Reset UI before calling LLM
// -------------------------------------

function resetUI(ui) {
  ui.error.style.display = "none";
  ui.stats.style.display = "none";
  ui.text.innerHTML = "";
  ui.thinking.innerHTML = "";
  ui.tool.innerHTML = "";
  ui.processing.style.display = "block";
}


// -------------------------------------
// 3. Handle Streaming chunks
// -------------------------------------
function handleStreaming(ui, eventName) {
  frappe.realtime.off(eventName);

  frappe.realtime.on(eventName, (data) => {
    ui.processing.style.display = "none";
    if (!data.chunk) return;

    const chunk = data.chunk;

    switch (chunk.type) {
      case "thinking":
        ui.thinking.style.display = "block";
        ui.thinking.innerHTML += frappe.utils.escape_html(chunk.content);
        break;

      case "tool_use":
        ui.tool.style.display = "block";
        ui.tool.innerHTML = `<pre>${frappe.utils.escape_html(chunk.content)}</pre>`;
        break;

      case "text":
      default:
        ui.text.style.display = "block";
        ui.text.innerHTML += frappe.utils.escape_html(chunk.content);
        break;
    }

    ui.responseArea.scrollTop = ui.responseArea.scrollHeight;
  });
}

// -------------------------------------
// 4. Render final LLM response
// -------------------------------------
function updateFinalUI(ui, { item, error }) {
  ui.processing.style.display = "none";

  if (!item || error) {
    ui.error.style.display = "block";
    ui.error.innerHTML = error || "No response item received";
    return;
  }

  ui.stats.style.display = "block";

  for (const c of item.content) {
    switch (c.type) {
      case "thinking":
        ui.thinking.style.display = "block";
        ui.thinking.innerHTML = c.text;
        break;

      case "tool_use":
        ui.tool.style.display = "block";
        ui.tool.innerHTML = JSON.stringify(
          { id: c.id, name: c.name, args: c.args },
          null,
          2
        );
        break;

      case "text":
      default:
        ui.text.style.display = "block";
        ui.text.innerHTML = c.text;
        break;
    }
  }
}