frappe.ui.form.on("Job Opening", {
  refresh: function (frm) {
    if (!frm.is_new()) {
      frm.add_custom_button(__("Generate JRSS"), () => {
        generate_jrss_from_uploaded_job_description(frm);
      }, __("Ask AI"))
    }

    if (frm.doc.custom_session_id) {
      frm.add_web_link(
        `/app/view-otto-session/${frm.doc.custom_session_id}`,
        __("Open in Session Viewer")
      );

      if (frm.doc.custom_upload_jd) {
        frm.add_custom_button(__("Get Technical Questions"), () => {
          generate_technical_questions_dialog(frm)
        }, __("Ask AI"))
      }
      
      if (frm.doc.custom_technical_questions && frm.doc.custom_technical_questions != '<div class="ql-editor read-mode"><p><br></p></div>') {
        frm.add_custom_button(__("Generate Boolean"), () => {
          generate_booleans_dialog(frm)
        }, __("Ask AI"))
      }

      if (frm.doc.custom_candidate_boolean && frm.doc.custom_candidate_boolean != "") {
        frm.add_custom_button(__("Get Screening Questions"), () => {
          generate_screening_question_dailog(frm)
        }, __("Ask AI"))
      }
    }
  },
  custom_upload_jd: function (frm) {
    if (frm.doc.custom_upload_jd) {
      frappe.call({
        method: "npro_ai.api.check_attached_file_format",
        args: {
          "file": frm.doc.custom_upload_jd
        },
        callback: function (r) {
          if (r.message) {
            frm.reload_doc()
          }
        }
      })
    }
  }
})

// -------------------- Generate JRSS --------------------

let generate_jrss_from_uploaded_job_description = function (frm) {
  if (!frm.doc.custom_upload_jd) {
    frappe.throw(__("Please upload Job Description first."));
  }
  else if (frm.doc.custom_session_id) {
    frm.scroll_to_field("custom_jrss_mandatory_skills")
  }
  else {
    generate_jrss_dialog(frm);
  }
}

function generate_jrss_dialog(frm) {

  let jrss_prompt = ""
  frappe.db.get_single_value("Npro AI Settings", "generate_jrss_prompt")
    .then(generate_jrss_prompt => {
      if (generate_jrss_prompt) {
        jrss_prompt = generate_jrss_prompt

        const id = Math.random().toString(36).substring(2, 15);
        let dialog = undefined;

        let dialog_field = [
          {
            fieldtype: "Data",
            fieldname: "generate_jrss_prompt",
            label: __("Generate JRSS Prompt"),
            read_only: 1,
            default: jrss_prompt
          },
          {
            fieldtype: "Data",
            fieldname: "additional_instructions",
            label: __("Additional Instructions"),
            read_only: 0,
          },
          {
            fieldtype: "Button",
            fieldname: "generate_jrss_button",
            label: __("Generate JRSS"),
            click: function () {
              getLLMResponseUI(id);
              dialog.get_primary_btn().prop("disabled", true);
              ask_to_generate_jrss(dialog, id)
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
          title: __("Generate JRSS from Job Description"),
          fields: dialog_field,
          primary_action_label: 'Add JRSS',
          primary_action: function (values) {
            console.log(values, "-----values")
            if (values.response_generated == 1) {
              frappe.call({
                method: "npro_ai.api.fill_jrss_from_generated_content",
                args: {
                  "docname": frm.doc.name,
                  "session_id": values.session_id || undefined,
                  "response_content": values.response_section || "",
                },
                freeze: true,
                freeze_message: __("Adding JRSS..."),
                callback: function (r) {
                  if (r.message) {
                    frappe.show_alert(__('JRSS Generated and Added to the Job Opening Successfully.'), 5);
                  }
                  frm.reload_doc();
                }
              })
              dialog.hide();
            }
            else {
              frappe.msgprint(__("Please Generate JRSS Before Proceeding."))
            }

          }
        })

        dialog.show()
      }
      else {
        frappe.throw(__("Please Set Generate JRSS Prompt In Npro AI Settings Doc"))
      }
    })
}

function ask_to_generate_jrss(dialog, id) {
  const d = dialog.get_values();

  const ui = getUIElements(id);
  resetUI(ui);
  handleStreaming(ui, "stream-llm");

  frappe.call({
    method: "npro_ai.api.generate_jrss_from_job_description",
    args: {
      jd_file: frm.doc.custom_upload_jd || "/files/Zostel - stay.pdf",
      generate_jrss_prompt: d.generate_jrss_prompt || "",
      additional_instructions: d.additional_instructions || "",
      session_id: d.session_id || undefined,
    },
    callback({ message }) {
      dialog.set_value("session_id", message.session_id);
      dialog.set_value("additional_instructions", "");
      dialog.set_value("response_generated", 1)

      dialog.set_df_property("additional_instructions", "label", "Re Define Instructions");
      dialog.set_df_property("generate_jrss_button", "label", "Regenerate JRSS");

      dialog.get_primary_btn().prop("disabled", false);
      updateFinalUI(ui, message);
    },
  });
}

// -------------------- Generate Technical Questions --------------------
let generate_technical_questions_dialog = function (frm) {

  if (frm.doc.custom_technical_questions && frm.doc.custom_technical_questions != '<div class="ql-editor read-mode"><p><br></p></div>') {
    frm.scroll_to_field("custom_technical_questions")
  }
  else {

    let technical_que_prompt = ""
    frappe.db.get_single_value("Npro AI Settings", "get_technical_questions_prompt")
      .then(get_technical_questions_prompt => {
        if (get_technical_questions_prompt) {
          technical_que_prompt = get_technical_questions_prompt

          const id = Math.random().toString(36).substring(2, 15);
          let dialog = undefined;

          let dialog_field = [
            {
              fieldtype: "Data",
              fieldname: "technical_question_prompt",
              label: __("Get Technical Questions Prompt"),
              read_only: 1,
              default: technical_que_prompt
            },
            {
              fieldtype: "Data",
              fieldname: "additional_instructions",
              label: __("Additional Instructions"),
              read_only: 0,
            },
            {
              fieldtype: "Button",
              fieldname: "generate_tech_button",
              label: __("Generate Technical Questions"),
              click: function () {
                getLLMResponseUI(id);
                dialog.get_primary_btn().prop("disabled", true);
                ask_to_generate_technical_que(dialog, id)
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
            title: __("Get Technical Questions"),
            fields: dialog_field,
            primary_action_label: 'Get Technical Questions',
            primary_action: function (values) {
              console.log(values, "-----values")
              if (values.response_generated == 1) {
                frappe.call({
                  method: "npro_ai.api.fill_technical_questions",
                  args: {
                    "docname": frm.doc.name,
                  },
                  freeze: true,
                  freeze_message: __("Adding Technical Questions..."),
                  callback: function (r) {
                    if (r.message) {
                      frappe.show_alert(__('Technical Questions Generated and Added to the Job Opening Successfully.'), 5);
                    }
                    frm.reload_doc();
                  }
                })
                dialog.hide();
              }
              else {
                frappe.msgprint(__("Please Generate Technical Questions Before Proceeding."))
              }


            }
          })

          dialog.show()
        }
        else {
          frappe.throw(__("Please Set Generate Technical Questions Prompt In Npro AI Settings Doc"))
        }
      })
  }
}

let ask_to_generate_technical_que = function (dialog, id) {
  const d = dialog.get_values();

  const ui = getUIElements(id);
  resetUI(ui);
  handleStreaming(ui, "stream-llm");
  frappe.call({
    method: "npro_ai.api.generate_technical_questions_from_jrss",
    args: {
      technical_question_prompt: d.technical_question_prompt || "",
      additional_instructions: d.additional_instructions || "",
      session_id: frm.doc.custom_session_id || undefined,
    },
    callback({ message }) {
      // dialog.set_value("session_id", message.session_id);
      dialog.set_value("additional_instructions", "");
      dialog.set_value("response_generated", 1)

      dialog.set_df_property("additional_instructions", "label", "Re Define Instructions");
      dialog.set_df_property("generate_tech_button", "label", "Regenerate Technical Questions");

      dialog.get_primary_btn().prop("disabled", false);
      updateFinalUI(ui, message);
    },
  });
}


// -------------------- Generate Boolean For Candidate Search --------------------

let generate_booleans_dialog = function (frm) {
  if (frm.doc.custom_candidate_boolean && frm.doc.custom_candidate_boolean != "") {
    frm.scroll_to_field("custom_candidate_boolean")
  }
  else {

    let boolean_prompt = ""
    frappe.db.get_single_value("Npro AI Settings", "generate_boolean_prompt")
      .then(generate_boolean_prompt => {
        if (generate_boolean_prompt) {
          boolean_prompt = generate_boolean_prompt

          const id = Math.random().toString(36).substring(2, 15);
          let dialog = undefined;

          let dialog_field = [
            {
              fieldtype: "Data",
              fieldname: "boolean_prompt",
              label: __("Get Boolean Prompt"),
              read_only: 1,
              default: boolean_prompt
            },
            {
              fieldtype: "Data",
              fieldname: "additional_instructions",
              label: __("Additional Instructions"),
              read_only: 0,
            },
            {
              fieldtype: "Button",
              fieldname: "generate_boolean_button",
              label: __("Generate Boolean"),
              click: function () {
                getLLMResponseUI(id);
                dialog.get_primary_btn().prop("disabled", true);
                ask_to_generate_boolean(dialog, id)
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
            title: __("Get Boolean For Candidate Search"),
            fields: dialog_field,
            primary_action_label: 'Get Boolean',
            primary_action: function (values) {
              console.log(values, "-----values")
              if (values.response_generated == 1) {
                frappe.call({
                  method: "npro_ai.api.fill_booleans",
                  args: {
                    "docname": frm.doc.name,
                  },
                  freeze: true,
                  freeze_message: __("Adding Booleans For Candidate Search..."),
                  callback: function (r) {
                    if (r.message) {
                      frappe.show_alert(__('Booleans For Candidate Search Generated and Added to the Job Opening Successfully.'), 5);
                    }
                    frm.reload_doc();
                  }
                })
                dialog.hide();
              }
              else {
                frappe.msgprint(__("Please Generate Boolean Before Proceeding."))
              }


            }
          })

          dialog.show()

        }
        else {
          frappe.throw(__("Please Set Generate Booleans Prompt In Npro AI Settings Doc"))
        }
      })

  }
}

let ask_to_generate_boolean = function (dialog, id) {
  const d = dialog.get_values();

  const ui = getUIElements(id);
  resetUI(ui);
  handleStreaming(ui, "stream-llm");
  frappe.call({
    method: "npro_ai.api.generate_booleans",
    args: {
      boolean_prompt: d.boolean_prompt || "",
      additional_instructions: d.additional_instructions || "",
      session_id: frm.doc.custom_session_id || undefined,
      technical_questions: frm.doc.custom_technical_questions,
      rejection_reason: frm.doc.custom_rejection_reason || undefined
    },
    callback({ message }) {
      // dialog.set_value("session_id", message.session_id);
      dialog.set_value("additional_instructions", "");
      dialog.set_value("response_generated", 1)

      dialog.set_df_property("additional_instructions", "label", "Re Define Instructions");
      dialog.set_df_property("generate_boolean_button", "label", "Regenerate Boolean");

      dialog.get_primary_btn().prop("disabled", false);
      updateFinalUI(ui, message);
    },
  });
}

// -------------------- Generate Screening Question For Candidate Search --------------------

let generate_screening_question_dailog = function (frm) {
  if (frm.doc.custom_screening_questions && frm.doc.custom_screening_questions != "") {
    frm.scroll_to_field("custom_screening_questions")
  }
  else {

    let screening_question_prompt = ""
    frappe.db.get_single_value("Npro AI Settings", "generate_screening_questions_prompt")
      .then(generate_screening_questions_prompt => {
        if (generate_screening_questions_prompt) {
          screening_question_prompt = generate_screening_questions_prompt

          const id = Math.random().toString(36).substring(2, 15);
          let dialog = undefined;

          let dialog_field = [
            {
              fieldtype: "Data",
              fieldname: "screening_question_prompt",
              label: __("Get Screeing Question Prompt"),
              read_only: 1,
              default: screening_question_prompt
            },
            {
              fieldtype: "Data",
              fieldname: "additional_instructions",
              label: __("Additional Instructions"),
              read_only: 0,
            },
            {
              fieldtype: "Button",
              fieldname: "generate_screening_question_button",
              label: __("Generate Screening Question"),
              click: function () {
                getLLMResponseUI(id);
                dialog.get_primary_btn().prop("disabled", true);
                ask_to_generate_screening_question(dialog, id)
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
            title: __("Get Screening Questions For Candidate Search"),
            fields: dialog_field,
            primary_action_label: 'Get Screening Questions',
            primary_action: function (values) {
              console.log(values, "-----values")
              if (values.response_generated == 1) {
                frappe.call({
                  method: "npro_ai.api.fill_screening_questions",
                  args: {
                    "docname": frm.doc.name,
                  },
                  freeze: true,
                  freeze_message: __("Adding Screening Questions..."),
                  callback: function (r) {
                    if (r.message) {
                      frappe.show_alert(__('Sceening Questions For Candidate are Generated and Added to the Job Opening Successfully.'), 5);
                    }
                    frm.reload_doc();
                  }
                })
                dialog.hide();
              }
              else {
                frappe.msgprint(__("Please Generate Screening Questions Before Proceeding."))
              }


            }
          })

          dialog.show()

        }
        else {
          frappe.throw(__("Please Set Generate Screening Question Prompt In Npro AI Settings Doc"))
        }
      })

  }
}

let ask_to_generate_screening_question = function (dialog, id) {
  const d = dialog.get_values();

  const ui = getUIElements(id);
  resetUI(ui);
  handleStreaming(ui, "stream-llm");
  frappe.call({
    method: "npro_ai.api.generate_screening_questions",
    args: {
      screening_question_prompt: d.screening_question_prompt || "",
      additional_instructions: d.additional_instructions || "",
      session_id: frm.doc.custom_session_id || undefined,
      technical_questions: frm.doc.custom_technical_questions,
      rejection_reason: frm.doc.custom_rejection_reason || undefined
    },
    callback({ message }) {
      // dialog.set_value("session_id", message.session_id);
      dialog.set_value("additional_instructions", "");
      dialog.set_value("response_generated", 1)

      dialog.set_df_property("additional_instructions", "label", "Re Define Instructions");
      dialog.set_df_property("generate_screening_question_button", "label", "Regenerate Screening Questions");

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