import crypto from "crypto";
import dotenv from "dotenv";
import { Generate_button_body, Generate_button_footer, Generate_button_header, Generate_message_body, Generate_template_variables, Generate_to_address } from "./help_functions/meta_utils";
import { GenerateEventArcTrigger, GenerateEventArcTriggerWebhook } from "./help_functions/genereate_eventarc_trigger";
import { generate_jwt } from "./help_functions/generate_jwt";
import { getwait_time } from "./help_functions/getwait_time";
import { GenerateWhatsAPPTextSteps } from "./gcp_workflow_steps/whatsapp_text_node";
import { GenerateWaitCallbackStep, GenerateWaitCallbackStepWebhook } from "./gcp_workflow_steps/wait_callback_step";
import { GenerateWhatsAPPTemplateSteps } from "./gcp_workflow_steps/whatsapp_template_node";
import { GeneretButtonSteps, YesStep } from "./gcp_workflow_steps/whatsapp_button_node";
import { findEdge, getStepsForEdge } from "./help_functions/react_flow";
import { GenerateDelayNodeSteps } from "./gcp_workflow_steps/delay_node";
import { GeneretMediaSteps } from "./gcp_workflow_steps/whatsapp_media_nodes";
import { GenerateConditions, GenerateConditionsData } from "./help_functions/generate_conditions";
import { GenerateConditionalSplitSteps } from "./gcp_workflow_steps/conditional_split";
import { GenerateTriggerSteps } from "./gcp_workflow_steps/trigger_node";
import { GenerateBranchData } from "./help_functions/generate_branch_conditions";
import { GenerateConditionalBranchSteps } from "./gcp_workflow_steps/condition_branch";
import { GenerateSaveDataSteps } from "./gcp_workflow_steps/save_data";
import { GenerateDynamicArgs, GenerateEmptyVariables, GenerateEmptyVariablesSaveVariable, GenerateVariables, ReplaceDynamicValues, transformPlaceholders } from "./help_functions/generate_variables";
import { GenerateSaveVariableSteps } from "./gcp_workflow_steps/save_variable";
import { FormatLoopValue } from "./help_functions/format_loop_value";
import { GenerateStartLoopSteps } from "./gcp_workflow_steps/start_loop_node";
import { GenerateListSteps, ListYesStep } from "./gcp_workflow_steps/whatsapp_list_node";
import { GenerateAPINodeSteps } from "./gcp_workflow_steps/api_node";
import { GenerateWebhookSteps } from "./gcp_workflow_steps/webhook_node";
import environment from "../environments";
import { GenerateWhatsAPPCatalogSteps } from "./gcp_workflow_steps/whatsapp_catalog_node";
import { GenerateUtilsFunctionSteps } from "./gcp_workflow_steps/utils_function";
import { logger } from "../utils/common";
import { GenerateNodeTitle } from "./help_functions/generate_node_title";
import { findBaseConnections } from "./help_functions/findbase_connections";
import { CreateGCPSubflowDefinition } from "./index_subflow";
import { SubflowModel } from "../db/models/subflow.model";
import { createGCPWorkflow, getWorkflow, listWorkflows, updateGCPWorkflowSource } from "../utils/workflow";
import { Branch } from "../db/models/branch.model";

dotenv.config();

const projectId = environment.GCP_PROJECT_ID ?? "";
const location = environment.GCP_WORKER_REGION ?? "";
const serviceAccount = environment.GCP_SERVICE_ACCOUNT ?? "";

export async function CreateGCPWorkflowDefinition(reactflowDefinition, location) {
    const currentNode = reactflowDefinition.fe_flow.nodes.find((node) => node.type === "triggerNode");
    const GCPworkflowDefinition = {
        main: {
            params: ["tg"],
            steps: [],
        },
    };

    let lastNodeResult = "";
    let args = GenerateDynamicArgs(reactflowDefinition);
    let subflowArgs = {
        tg: "${tg}",
        exeId: "${exeId}",
    };
    /**
     * Processes a node and generates the corresponding steps for the GCP workflow.
     * @param node - The node to process.
     * @param index - The index of the node in the workflow.
     * @returns A promise that resolves to an array of steps.
     */
    async function processNode(node, isInsideLoop = false) {
        const workflowTitle = reactflowDefinition.title.replace(/[\s_]+/g, "").toLowerCase();
        const message_id = Math.floor(1000 + Math.random() * 9000).toString();
        let nodeTitle = node.data.title;
        if (node.type !== "unknown") {
            nodeTitle = GenerateNodeTitle(node.data.title, node.type);
        }

        node.data.to = Generate_to_address(node.data?.to);

        node.data.workflowTitle = reactflowDefinition.title;
        node.data.organisation_id = reactflowDefinition.organisation_id;
        node.data.branch_id = reactflowDefinition.branch_id;
        node.data.flow_id = reactflowDefinition._id;

        switch (node.type) {
            case "triggerNode":
                return handleTriggerNode(node, message_id, nodeTitle);
            case "whatsappTextNode":
                return handleWhatsAppTextNode(node, message_id, nodeTitle, workflowTitle);
            case "whatsappNode":
                return handleWhatsAppNode(node, message_id, workflowTitle, nodeTitle);
            case "buttonMessageNode":
                return handleWhatsAppButtonNode(node, message_id, nodeTitle, workflowTitle);
            case "delayNode":
                return handleDelayNode(node, message_id, workflowTitle);
            case "mediaMessageNode":
                return handleMediaMessageNode(node, message_id, nodeTitle, workflowTitle);
            case "conditionSplitNode":
                return handleConditionSplitNode(node, message_id, workflowTitle);
            case "conditionBranchNode":
                return handleConditionBranchNode(node, message_id, workflowTitle);
            case "saveDataNode":
                return handleSaveDataNode(node, message_id, workflowTitle);
            case "saveVariableNode":
                return handleSaveVariableNode(node, message_id, nodeTitle, workflowTitle);
            case "startLoopNode":
                return handleStartLoopNode(node, message_id, workflowTitle);
            case "listMessageNode":
                return handleWhatsappListNode(node, message_id, nodeTitle, workflowTitle);
            case "apiNode":
                return handleApiNode(node, message_id, workflowTitle);
            case "webhookNode":
                return handleWebhookNode(node, message_id, nodeTitle, workflowTitle);
            case "catalogMessageNode":
                return handleCatalogMessageNode(node, message_id, nodeTitle, workflowTitle);
            case "utilsFunctionNode":
                return handleUtilsFunctionNode(node, message_id, nodeTitle, workflowTitle);
            case "subflowNode":
                return handleSubflowNode(node, message_id, nodeTitle);
            case "internalAlertNode":
                return handleInternalAlertNode(node, message_id, workflowTitle, nodeTitle);
            default:
                return handleDefaultNode(node, isInsideLoop, message_id);
        }
    }

    /**
     * Handles the processing of a trigger node.
     * @param node - The trigger node to process.
     * @param index - The index of the node in the workflow.
     * @returns A promise that resolves to an array of steps.
     */
    async function handleTriggerNode(node, message_id, nodeTitle) {
        const baseConnections = findBaseConnections(reactflowDefinition.fe_flow.nodes, reactflowDefinition.fe_flow.edges);
        const saveVariableNodes = reactflowDefinition.fe_flow.nodes.filter((n) => n.type === "saveVariableNode" && node.id === baseConnections[n.id]);
        const apiNodes = reactflowDefinition.fe_flow.nodes.filter((n) => n.type === "apiNode" && node.id === baseConnections[n.id]);
        const whatsappTextNode = reactflowDefinition.fe_flow.nodes.filter((n) => n.type === "whatsappTextNode" && node.id === baseConnections[n.id]);
        const webhookNode = reactflowDefinition.fe_flow.nodes.filter((n) => n.type === "webhookNode" && node.id === baseConnections[n.id]);
        const catalogMessageNode = reactflowDefinition.fe_flow.nodes.filter((n) => n.type === "catalogMessageNode" && node.id === baseConnections[n.id]);
        const utilsFunctionNode = reactflowDefinition.fe_flow.nodes.filter((n) => n.type === "utilsFunctionNode" && node.id === baseConnections[n.id]);
        const listMessageNode = reactflowDefinition.fe_flow.nodes.filter((n) => n.type === "listMessageNode" && node.id === baseConnections[n.id]);
        const mediaMessageNode = reactflowDefinition.fe_flow.nodes.filter((n) => n.type === "mediaMessageNode" && node.id === baseConnections[n.id]);
        const buttonMessageNode = reactflowDefinition.fe_flow.nodes.filter((n) => n.type === "buttonMessageNode" && node.id === baseConnections[n.id]);
        const templateMessageNode = reactflowDefinition.fe_flow.nodes.filter((n) => n.type === "whatsappNode" && node.id === baseConnections[n.id]);
        const subflowNode = reactflowDefinition.fe_flow.nodes.filter((n) => n.type === "subflowNode" && node.id === baseConnections[n.id]);

        let steps = [];
        let assign_variables = [];
        let branchData =  await Branch.findById(reactflowDefinition.branch_id);
        assign_variables.push(
            { "tg.branch_id": reactflowDefinition.branch_id },
            { "tg.branch_name": branchData?.name  }
        );
        if (saveVariableNodes.length > 0) {
            saveVariableNodes.map((n) => {
                const variableObject = GenerateEmptyVariablesSaveVariable(n);
                let variableName = GenerateNodeTitle(n.data.title, n.type);
                assign_variables.push({ [variableName]: variableObject });
                args[variableName] = `\${${variableName}}`;
                subflowArgs = { ...subflowArgs, [variableName]: `\${${variableName}}` };
            });
        }

        if (apiNodes.length > 0) {
            apiNodes.map((n) => {
                let variableName = GenerateNodeTitle(n.data.title, n.type);
                assign_variables.push({ [variableName]: {} });
                args[variableName] = `\${${variableName}}`;
                subflowArgs = { ...subflowArgs, [variableName]: `\${${variableName}}` };
            });
        }

        if (whatsappTextNode.length > 0) {
            whatsappTextNode.map((n) => {
                let variableName = GenerateNodeTitle(n.data.title, n.type);
                assign_variables.push({ [variableName]: {} });
                args[variableName] = `\${${variableName}}`;
                subflowArgs = { ...subflowArgs, [variableName]: `\${${variableName}}` };
            });
        }

        if (webhookNode.length > 0) {
            webhookNode.map((n) => {
                let variableName = GenerateNodeTitle(n.data.title, n.type);
                assign_variables.push({ [variableName]: {} });
                args[variableName] = `\${${variableName}}`;
                subflowArgs = { ...subflowArgs, [variableName]: `\${${variableName}}` };
            });
        }

        if (catalogMessageNode.length > 0) {
            catalogMessageNode.map((n) => {
                let variableName = GenerateNodeTitle(n.data.title, n.type);
                assign_variables.push({ [variableName]: {} });
                args[variableName] = `\${${variableName}}`;
                subflowArgs = { ...subflowArgs, [variableName]: `\${${variableName}}` };
            });
        }

        if (utilsFunctionNode.length > 0) {
            utilsFunctionNode.map((n) => {
                let variableName = GenerateNodeTitle(n.data.title, n.type);
                assign_variables.push({ [variableName]: {} });
                args[variableName] = `\${${variableName}}`;
                subflowArgs = { ...subflowArgs, [variableName]: `\${${variableName}}` };
            });
        }

        if (listMessageNode.length > 0) {
            listMessageNode.map((n) => {
                let variableName = GenerateNodeTitle(n.data.title, n.type);
                assign_variables.push({ [variableName]: {} });
                args[variableName] = `\${${variableName}}`;
                subflowArgs = { ...subflowArgs, [variableName]: `\${${variableName}}` };
            });
        }

        if (mediaMessageNode.length > 0) {
            mediaMessageNode.map((n) => {
                let variableName = GenerateNodeTitle(n.data.title, n.type);
                assign_variables.push({ [variableName]: {} });
                args[variableName] = `\${${variableName}}`;
                subflowArgs = { ...subflowArgs, [variableName]: `\${${variableName}}` };
            });
        }

        if (buttonMessageNode.length > 0) {
            buttonMessageNode.map((n) => {
                let variableName = GenerateNodeTitle(n.data.title, n.type);
                assign_variables.push({ [variableName]: {} });
                args[variableName] = `\${${variableName}}`;
                subflowArgs = { ...subflowArgs, [variableName]: `\${${variableName}}` };
            });
        }

        if (templateMessageNode.length > 0) {
            templateMessageNode.map((n) => {
                let variableName = GenerateNodeTitle(n.data.title, n.type);
                assign_variables.push({ [variableName]: {} });
                args[variableName] = `\${${variableName}}`;
                subflowArgs = { ...subflowArgs, [variableName]: `\${${variableName}}` };
            });
        }

        if (subflowNode.length > 0) {
            subflowNode.map((n) => {
                let variableName = GenerateNodeTitle(n.data.title, n.type);
                assign_variables.push({ [variableName]: {} });
                args[variableName] = `\${${variableName}}`;
                subflowArgs = { ...subflowArgs, [variableName]: `\${${variableName}}` };
            });
            args = subflowArgs;
        }
        GCPworkflowDefinition.main.steps.push({
            gt_exeId_m: {
                call: "sys.get_env",
                args: {
                    name: "GOOGLE_CLOUD_WORKFLOW_EXECUTION_ID",
                },
                result: "exeId",
            },
        });
        GCPworkflowDefinition.main.steps.push({
            assign_variables: {
                assign: assign_variables,
            },
        });

        const nextEdge = reactflowDefinition.fe_flow.edges.find((edge) => edge.source === node.id);
        const yesSteps = await getStepsForEdge(reactflowDefinition, nextEdge, processNode, node.data.title);
        // return processNode(nextNode, 0);

        // const uniqueTriggerYes = `triggerYesPSWF_${message_id}`;
        // const uniqueTriggerSubName = `triggerSubWorkflow_${message_id}`;
        // GCPworkflowDefinition[uniqueTriggerYes] = {
        //     params: Object.keys(args),
        //     steps: yesSteps,
        // };
        // GCPworkflowDefinition[uniqueTriggerSubName] = GenerateTriggerSteps(uniqueTriggerYes, args);
        GCPworkflowDefinition.main.steps.push({
            [nodeTitle]: {
                steps: yesSteps,
            },
        });
        lastNodeResult = nodeTitle;
        return steps;
    }

    /**
     * Handles the processing of a WhatsApp text node.
     * @param node - The WhatsApp text node to process.
     * @param index - The index of the node in the workflow.
     * @param message_id - The unique message ID.
     * @param uniqueTextName - The unique name for the text node.
     * @param workflowTitle - The title of the workflow.
     * @returns A promise that resolves to an array of steps.
     */
    async function handleWhatsAppTextNode(node, message_id, uniqueTextName, workflowTitle) {
        let steps = [];
        if (node?.data?.meta_payload?.body) {
            node.data.meta_payload.body = Generate_message_body(node);
        }

        if (node.data.form_payload.is_response_wait) {
            // Trigger EventArc
            GenerateEventArcTrigger({ location, projectId, reactflowDefinition, serviceAccount });

            // Get "yes" and "no" edges and steps
            const yesEdge = findEdge(reactflowDefinition, node.id, "next-step");
            const noEdge = findEdge(reactflowDefinition, node.id, "no-response");
            const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);
            const noSteps = await getStepsForEdge(reactflowDefinition, noEdge, processNode, node.data.title);

            const uniqueTextSubName = `wTSW_${message_id}`;
            GCPworkflowDefinition.message_await_callback_event = GenerateWaitCallbackStep;
            return addMainStepTextNode(uniqueTextName, uniqueTextSubName, node, workflowTitle, steps, false, args, yesSteps, noSteps, message_id);

            // Define WhatsApp text workflow and callback
        } else {
            // Get "yes" edge and steps (no "no" edge in this case)
            const yesEdge = findEdge(reactflowDefinition, node.id, "next-step");
            const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);

            /**
             * tYPSW stands for text Yes path subworkflow
             * wTSW stands for WhatsApp Text Subworkflow
             */
            const uniqueTextSubName = `wTSW_${message_id}`;

            // Set form payload response wait to 0 seconds
            // node.data.form_payload.response_wait = '0';
            // node.data.form_payload.response_wait_unit = 'seconds';
            GCPworkflowDefinition.message_await_callback_event = GenerateWaitCallbackStep;
            return addMainStepTextNode(uniqueTextName, uniqueTextSubName, node, workflowTitle, steps, true, args, yesSteps, [], message_id);
        }
    }

    /**
     * Handles the processing of a WhatsApp template node.
     * @param node - The WhatsApp template node to process.
     * @param index - The index of the node in the workflow.
     * @param message_id - The unique message ID.
     * @param workflowTitle - The title of the workflow.
     * @returns A promise that resolves to an array of steps.
     */
    async function handleWhatsAppNode(node, message_id, workflowTitle, uniqueTextName) {
        let steps = [];
        const Buttons = node.data.form_payload.buttons || [];
        /**
         * tmn stands for template message node
         * tmNPSW stands for template message No path subworkflow
         * tmNxtPSW stands for template message Next path subworkflow
         */
        const uniqueButtonSub = `tmn_${message_id}`;
        const uniqueTextNo = `tmNPSWF_${message_id}`;
        const uniqueTextNext = `tmNxtPSWF_${message_id}`;
        // the line below is the error coming from
        if (node.data.meta_payload.components.find((comp) => comp.type === "body")?.parameters) {
            node.data.meta_payload.components.find((comp) => comp.type === "body").parameters = Generate_template_variables(node, "body");
        }
        if (node.data.meta_payload.components.find((comp) => comp.type === "header")?.parameters) {
            node.data.meta_payload.components.find((comp) => comp.type === "header").parameters = Generate_template_variables(node, "header");
        }
        if (node.data.meta_payload.components.find((comp) => comp.type === "button")?.parameters) {
            node.data.meta_payload.components.find((comp) => comp.type === "button").parameters = Generate_template_variables(node, "button");
        }
        node.data.form_payload.template = null;
        const YesSteps = Buttons.map((button) => {
            return {
                button: button.id.replace(/[^a-zA-Z0-9]/g, ""),
                org_button_id: button.id,
                title: button.title,
                edge: reactflowDefinition.fe_flow.edges.find(
                    (edge) => edge.source === node.id && edge.sourceHandle === button.id // use the correctly formatted sourceHandle
                ),
            };
        });
        const nextEdge = findEdge(reactflowDefinition, node.id, "next-step");
        const nextSteps = await getStepsForEdge(reactflowDefinition, nextEdge, processNode, node.data.title);
        GCPworkflowDefinition[uniqueTextNext] = {
            params: Array.from(new Set([...Object.keys(args)])),
            steps: nextSteps,
        };
        const noEdge = findEdge(reactflowDefinition, node.id, "no-response");
        const noSteps = await getStepsForEdge(reactflowDefinition, noEdge, processNode, node.data.title);
        GCPworkflowDefinition[uniqueTextNo] = {
            params: Array.from(new Set([...Object.keys(args), node.data.title])),
            steps: noSteps,
        };

        GenerateEventArcTrigger({ location, projectId, reactflowDefinition, serviceAccount });

        for (let i = 0; i < YesSteps.length; i++) {
            const YesStep = YesSteps[i];
            const [buttonName, id] = YesStep.org_button_id.split("-");
            if (YesStep.edge) {
                const yesEdge = findEdge(reactflowDefinition, node.id, buttonName);
                const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);
                GCPworkflowDefinition[`call${YesStep.button}PSWF_${message_id}`] = {
                    params: Object.keys(args),
                    steps: yesSteps,
                };
            } else {
                GCPworkflowDefinition[`call${YesStep.button}PSWF_${message_id}`] = {
                    params: Object.keys(args),
                    steps: [
                        {
                            return_default: {
                                return: `No further steps defined for ${YesStep.button}`,
                            },
                        },
                    ],
                };
            }
        }

        const noResponseEdge = reactflowDefinition.fe_flow.edges.find((edge) => edge.source === node.id && edge.sourceHandle.includes(`no-response-${edge.source}`));

        if (noResponseEdge) {
            const targetNode = reactflowDefinition.fe_flow.nodes.find((nextNode) => nextNode.id === noResponseEdge.target);
            const noResponseSteps = targetNode ? await getStepsForEdge(reactflowDefinition, noResponseEdge, processNode, node.data.title) : [];

            GCPworkflowDefinition[`callNRPSWF_${message_id}`] = {
                params: Object.keys(args),
                steps: noResponseSteps.length
                    ? noResponseSteps
                    : [
                        {
                            return_default: {
                                return: "No further steps defined for No response",
                            },
                        },
                    ],
            };
        }
        GCPworkflowDefinition[uniqueButtonSub] = GenerateWhatsAPPTemplateSteps(node, uniqueTextName, YesSteps, message_id, uniqueTextNo, uniqueTextNext, args);
        GCPworkflowDefinition.message_await_callback_event = GenerateWaitCallbackStep;
        return addMainStep(uniqueButtonSub, uniqueButtonSub, node, workflowTitle, steps, !node.data.form_payload.is_response_wait, args);
    }

    async function handleWhatsAppButtonNode(node, message_id, uniqueTextName, workflowTitle) {
        let steps = [];
        const Buttons = node.data.meta_payload.action.buttons || [];
        const uniqueButtonSub = `bmn_${message_id}`;

        node.data.meta_payload.body.text = Generate_button_body(node);
        if (node.data?.meta_payload?.footer?.text) {
            node.data.meta_payload.footer.text = Generate_button_footer(node);
        }
        if (node.data?.meta_payload?.header?.text) {
            node.data.meta_payload.header.text = Generate_button_header(node);
            const YesSteps = Buttons.map((button) => {
                return {
                    button: button.reply.id.replace(/[^a-zA-Z0-9]/g, ""),
                    org_button_id: button.reply.id,
                    title: button.reply.title,
                    edge: reactflowDefinition.fe_flow.edges.find(
                        (edge) => edge.source === node.id && edge.sourceHandle === `${button.reply.id}-${edge.source}` // use the correctly formatted sourceHandle
                    ),
                };
            });

            GenerateEventArcTrigger({ location, projectId, reactflowDefinition, serviceAccount });

            for (let i = 0; i < YesSteps.length; i++) {
                const YesStep = YesSteps[i];
                const [buttonName, id] = YesStep.org_button_id.split("-");
                if (YesStep.edge) {
                    const yesEdge = findEdge(reactflowDefinition, node.id, buttonName);
                    const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);
                    GCPworkflowDefinition[`call${YesStep.button}PSWF_${message_id}`] = {
                        params: Object.keys(args),
                        steps: yesSteps,
                    };
                } else {
                    GCPworkflowDefinition[`call${YesStep.button}PSWF_${message_id}`] = {
                        params: Object.keys(args),
                        steps: [
                            {
                                return_default: {
                                    return: `No further steps defined for ${YesStep.button}`,
                                },
                            },
                        ],
                    };
                }
            }

            const noResponseEdge = reactflowDefinition.fe_flow.edges.find((edge) => edge.source === node.id && edge.sourceHandle.includes(`no-response-${edge.source}`));

            if (noResponseEdge) {
                const targetNode = reactflowDefinition.fe_flow.nodes.find((nextNode) => nextNode.id === noResponseEdge.target);
                const noResponseSteps = targetNode ? await getStepsForEdge(reactflowDefinition, noResponseEdge, processNode, node.data.title) : [];

                // callNRPSW stands for call No Response Path Subworkflow
                GCPworkflowDefinition[`callNRPSWF_${message_id}`] = {
                    params: Object.keys(args),
                    steps: noResponseSteps.length
                        ? noResponseSteps
                        : [
                            {
                                return_default: {
                                    return: "No further steps defined for No response",
                                },
                            },
                        ],
                };
            }

            GCPworkflowDefinition[uniqueButtonSub] = GeneretButtonSteps(node, YesSteps, message_id, noResponseEdge, node.data.form_payload.is_check_format, args);
            GCPworkflowDefinition.message_await_callback_event = GenerateWaitCallbackStep;

            if (node.data.form_payload.is_response_wait) {
                return addMainStep(uniqueButtonSub, uniqueButtonSub, node, workflowTitle, steps, false, args);
            } else {
                return addMainStep(uniqueButtonSub, uniqueButtonSub, node, workflowTitle, steps, true, args);
            }
        }

        async function handleDelayNode(node, message_id, workflowTitle) {
            let steps = [];
            node.data.response_wait_unit = node.data.unit;
            node.data.response_wait = node.data.delay;

            const uniqueDelayYes = `dlyYPSWF_${message_id}`;
            const uniqueDelaySubName = `dlySWF_${message_id}`;

            let seconds = getwait_time(node.data);

            const yesEdge = findEdge(reactflowDefinition, node.id, "next-step");
            const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);

            const delayArgs = GenerateDelayNodeSteps(node, seconds);

            return addMainStepDelay(node, delayArgs, node.data.title, yesSteps, message_id, steps);
        }

        async function handleMediaMessageNode(node, message_id, uniqueTextName, workflowTitle) {
            let steps = [];

            const uniqueMediaSub = `mmn_${message_id}`;

            const yesEdge = findEdge(reactflowDefinition, node.id, "next-step");
            const noEdge = findEdge(reactflowDefinition, node.id, "no-response");
            const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);
            const noSteps = await getStepsForEdge(reactflowDefinition, noEdge, processNode, node.data.title);

            const uniqueMediaYes = `mYPSWF_${message_id}`;
            const uniqueMediaNo = `mNPSWF_${message_id}`;

            GCPworkflowDefinition[uniqueMediaYes] = {
                params: Array.from(new Set([...Object.keys(args), node.data.title])),
                steps: yesSteps,
            };

            if (node.data.form_payload.is_response_wait) {
                GCPworkflowDefinition[uniqueMediaNo] = {
                    params: Array.from(new Set([...Object.keys(args), node.data.title])),
                    steps: noSteps,
                };
                GCPworkflowDefinition[uniqueMediaSub] = GeneretMediaSteps(node, uniqueMediaYes, true, args, uniqueMediaNo);
                GCPworkflowDefinition.message_await_callback_event = GenerateWaitCallbackStep;
                return addMainStep(uniqueMediaSub, uniqueMediaSub, node, workflowTitle, steps, false, args);
            } else {
                GCPworkflowDefinition[uniqueMediaSub] = GeneretMediaSteps(node, uniqueMediaYes, false, args);
                return addMainStep(uniqueMediaSub, uniqueMediaSub, node, workflowTitle, steps, true, args);
            }
        }

        async function handleConditionSplitNode(node, message_id, workflowTitle) {
            let steps = [];
            const uniqueConditonalSplitSub = `csn_${message_id}`;

            const yesEdge = findEdge(reactflowDefinition, node.id, "yes");
            const noEdge = findEdge(reactflowDefinition, node.id, "no");
            const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);
            const noSteps = await getStepsForEdge(reactflowDefinition, noEdge, processNode, node.data.title);

            // const uniqueConditionYes = `csYPSWF_${message_id}`;
            // const uniqueConditionNo = `csNPSWF_${message_id}`;

            // GCPworkflowDefinition[uniqueConditionYes] = {
            //     params: Object.keys(args),
            //     steps: yesSteps,
            // };

            // GCPworkflowDefinition[uniqueConditionNo] = {
            //     params: Object.keys(args),
            //     steps: noSteps,
            // };

            const dataArg = GenerateConditionsData(node);
            const conditionsArg = GenerateConditions(node);
            const filterGroupCondition = node.data.filterGroupCondition;

            // GCPworkflowDefinition[uniqueConditonalSplitSub] = GenerateConditionalSplitSteps(node, uniqueConditionYes, uniqueConditionNo, args);
            return addMainStepConditionalSplit(uniqueConditonalSplitSub, uniqueConditonalSplitSub, steps, dataArg, conditionsArg, filterGroupCondition, yesSteps, noSteps, args);
        }

        async function handleConditionBranchNode(node, message_id, workflowTitle) {
            let steps = [];
            const Buttons = node.data.paths || [];
            const uniqueConditonalBranchSub = `cbn_${message_id}`;

            const dataArg = GenerateBranchData(node);
            const YesSteps = Buttons.map((button) => {
                return {
                    button: button.label.replace(/\s+/g, "_"),
                    title: button.label,
                    edge: reactflowDefinition.fe_flow.edges.find(
                        (edge) => edge.source === node.id && edge.sourceHandle === `${button.label.replace(/\s+/g, "_").toUpperCase()}-${node.id}` // use the correctly formatted sourceHandle
                    ),
                };
            });

            for (let i = 0; i < YesSteps.length; i++) {
                const YesStep = YesSteps[i];
                const buttonName = YesStep.button.toUpperCase();
                if (YesStep.edge) {
                    const yesEdge = findEdge(reactflowDefinition, node.id, buttonName);
                    const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);
                    GCPworkflowDefinition[`call${YesStep.button}SWF_${message_id}`] = {
                        params: Object.keys(args),
                        steps: yesSteps,
                    };
                } else {
                    GCPworkflowDefinition[`call${YesStep.button}SWF_${message_id}`] = {
                        params: Object.keys(args),
                        steps: [
                            {
                                return_default: {
                                    return: `No further steps defined for ${YesStep.button}`,
                                },
                            },
                        ],
                    };
                }
            }
            GCPworkflowDefinition[uniqueConditonalBranchSub] = GenerateConditionalBranchSteps(YesSteps, message_id, args);
            return addMainStepConditionalBranch(node.data.title, uniqueConditonalBranchSub, steps, dataArg, Buttons, args);
        }

        async function handleSaveDataNode(node, message_id, workflowTitle) {
            let steps = [];
            let columns = node.data.columns;
            const uniqueSaveDataYes = `sdYPSWF_${message_id}`;
            const uniqueSaveDataSubName = `sdSWF_${message_id}`;
            const yesEdge = findEdge(reactflowDefinition, node.id, "next-step");
            const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);

            // GCPworkflowDefinition[uniqueSaveDataYes] = {
            //     params: Array.from(new Set([...Object.keys(args), node.data.title])),
            //     steps: yesSteps,
            // };
            const table_ref = node.data.table;
            // GCPworkflowDefinition[uniqueSaveDataSubName] = GenerateSaveDataSteps(node.data.title, columns, table_ref, uniqueSaveDataYes, reactflowDefinition, args);
            const { graphqlMutation, graphqlVariables } = GenerateSaveDataSteps(node.data.title, columns, table_ref, uniqueSaveDataYes, reactflowDefinition, args);
            return addMainStepSaveData(node.data.title, graphqlMutation, graphqlVariables, yesSteps, steps, args);
        }

        async function handleSaveVariableNode(node, message_id, uniqueTextName, workflowTitle) {
            let steps = [];
            const uniqueVariableYes = `svYPSWF_${message_id}`;
            const uniqueVariableSubName = `svSWF_${message_id}`;
            const yesEdge = findEdge(reactflowDefinition, node.id, "next-step");
            const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);

            // GCPworkflowDefinition[uniqueVariableYes] = {
            //     params: Array.from(new Set([...Object.keys(args), node.data.title])),
            //     steps: yesSteps,
            // };
            const variableObject = GenerateVariables(node);
            // GCPworkflowDefinition[uniqueVariableSubName] = GenerateSaveVariableSteps(node.data.title, variableObject, uniqueVariableYes, args);
            return addMainStepSaveVariable(node, uniqueTextName, steps, variableObject, yesSteps, args);
        }

        async function handleStartLoopNode(node, message_id, workflowTitle) {
            let steps = [];
            let loopValue = FormatLoopValue(node.data.loop_list);
            const loopLimit = node.data.limit;

            const uniqueLoopYes = `lpYPSWF_${message_id}`;
            const uniqueLoopControlSubName = `lpCSWF_${message_id}`;

            const nextEdgeLoop = reactflowDefinition.fe_flow.edges.find((edge) => edge.source === node.id);
            const endLoopNode = reactflowDefinition.fe_flow.nodes.find((node) => node.type === "endLoopNode");
            const endLoopEdge = reactflowDefinition.fe_flow.edges.find((edge) => edge.source === endLoopNode?.id);
            const yesSteps = await getStepsForEdge(reactflowDefinition, endLoopEdge, processNode, node.data.title);
            logger.log("info", `endLoopEdge:${endLoopEdge},steps:${yesSteps}`);
            GCPworkflowDefinition[uniqueLoopYes] = {
                params: Array.from(new Set([...Object.keys(args), node.data.title])),
                steps: yesSteps,
            };
            const loopSteps = [];

            let currentStepNode = reactflowDefinition.fe_flow.nodes.find((node) => node.id === nextEdgeLoop?.target);
            while (currentStepNode && currentStepNode.id !== endLoopNode?.id) {
                if (currentStepNode.type !== "delayNode") {
                // Avoid duplicating delay nodes
                    const step = await processNode(currentStepNode, true);
                    loopSteps.push(...step);
                }
                // Move to the next node by finding the edge originating from the current node
                const nextEdge = reactflowDefinition.fe_flow.edges.find((edge) => edge.source === currentStepNode.id);
                currentStepNode = reactflowDefinition.fe_flow.nodes.find((node) => node.id === nextEdge?.target);
            }

            GCPworkflowDefinition[uniqueLoopControlSubName] = GenerateStartLoopSteps(node, loopSteps, uniqueLoopYes, args);
            return addMainStepLoop(node.data.title, uniqueLoopControlSubName, loopValue, loopLimit, node, steps, args);
        }

        async function handleWhatsappListNode(node, message_id, uniqueTextName, workflowTitle) {
            let steps = [];
            const sections = node.data.meta_payload.action.sections || [];
            const uniqueButtonSub = `lsmn_${message_id}`;

            node.data.meta_payload.body.text = Generate_button_body(node);
            if (node.data?.meta_payload?.footer?.text) {
                node.data.meta_payload.footer.text = Generate_button_footer(node);
            }
            if (node.data?.meta_payload?.header?.text) {
                node.data.meta_payload.header.text = Generate_button_header(node);
            }

            const YesSteps = sections.flatMap((section) =>
                (section.rows || []).map((row) => {
                    return {
                        id: row.id, // Extract the row ID
                        row: row.id.replace(/[^a-zA-Z0-9]/g, ""), // Clean the row ID
                        edge: reactflowDefinition.fe_flow.edges.find(
                            (edge) => edge.source === node.id && edge.sourceHandle === `${row.id}-${node.id}` // use the correctly formatted sourceHandle
                        ),
                    };
                })
            );

            GenerateEventArcTrigger({ location, projectId, reactflowDefinition, serviceAccount });

            for (let i = 0; i < YesSteps.length; i++) {
                const YesStep = YesSteps[i];
                if (YesStep.edge) {
                    const yesEdge = findEdge(reactflowDefinition, node.id, YesStep.id);
                    const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);
                    GCPworkflowDefinition[`call${YesStep.row}PSWF_${message_id}`] = {
                        params: Object.keys(args),
                        steps: yesSteps,
                    };
                } else {
                    GCPworkflowDefinition[`call${YesStep.row}PSWF_${message_id}`] = {
                        params: Object.keys(args),
                        steps: [
                            {
                                return_default: {
                                    return: `No further steps defined for ${YesStep.row}`,
                                },
                            },
                        ],
                    };
                }
            }

            const noResponseEdge = reactflowDefinition.fe_flow.edges.find((edge) => edge.source === node.id && edge.sourceHandle.includes(`no-response-${edge.source}`));

            if (noResponseEdge) {
                const targetNode = reactflowDefinition.fe_flow.nodes.find((nextNode) => nextNode.id === noResponseEdge.target);
                const noResponseSteps = targetNode ? await getStepsForEdge(reactflowDefinition, noResponseEdge, processNode, node.data.title) : [];
                /**
             * callNRPSWF stands for call No Response Path Subworkflow
             */
                GCPworkflowDefinition[`cNRPSWF_${message_id}`] = {
                    params: Object.keys(args),
                    steps: noResponseSteps.length
                        ? noResponseSteps
                        : [
                            {
                                return_default: {
                                    return: "No further steps defined for No response",
                                },
                            },
                        ],
                };
            }

            GCPworkflowDefinition[uniqueButtonSub] = GenerateListSteps(node, uniqueTextName, YesSteps, message_id, noResponseEdge, node.data.form_payload.is_check_format, args);
            GCPworkflowDefinition.message_await_callback_event = GenerateWaitCallbackStep;

            if (node.data.form_payload.is_response_wait) {
                return addMainStep(uniqueTextName, uniqueButtonSub, node, workflowTitle, steps, false, args);
            } else {
                return addMainStep(uniqueTextName, uniqueButtonSub, node, workflowTitle, steps, true, args);
            }
        }

        async function handleApiNode(node, message_id, workflowTitle) {
            let steps = [];
            const yesEdge = findEdge(reactflowDefinition, node.id, "next-step");
            const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);
            node.data = ReplaceDynamicValues(node);
            return addMainAPIStep(node, node.data.title, message_id, steps, yesSteps, args);
        }

        async function handleWebhookNode(node, message_id, uniqueTextName, workflowTitle) {
            let steps = [];
            const uniqueWebhookSub = `wbhn_${message_id}`;

            const yesEdge = findEdge(reactflowDefinition, node.id, "next-step");
            const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);

            const uniqueWebhookYes = `wbhYPSWF_${message_id}`;

            GCPworkflowDefinition[uniqueWebhookYes] = {
                params: Array.from(new Set([...Object.keys(args), uniqueTextName])),
                steps: yesSteps,
            };

            let triggerId;
            if (node.data.type === "custom") {
                triggerId = node.data.webhook_id;
            } else {
                triggerId = `${workflowTitle}_${node.data.title}`;
            }

            GenerateEventArcTriggerWebhook({ projectId, location, serviceAccount, triggerId });

            GCPworkflowDefinition.await_callback_event_webhook = GenerateWaitCallbackStepWebhook;

            GCPworkflowDefinition[uniqueWebhookSub] = GenerateWebhookSteps(node, uniqueTextName, uniqueWebhookYes, message_id, args, triggerId);

            return addMainStepWebhook(node.data.title, uniqueWebhookSub, steps, args);
        }

        async function handleCatalogMessageNode(node, message_id, uniqueTextName, workflowTitle) {
            let steps = [];
            const uniqueCatalogSub = `ctlgmn_${message_id}`;

            const yesEdge = findEdge(reactflowDefinition, node.id, "next-step");
            const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);

            const uniqueCatalogYes = `ctlgYPSWF_${message_id}`;

            GCPworkflowDefinition[uniqueCatalogYes] = {
                params: Array.from(new Set([...Object.keys(args), uniqueTextName])),
                steps: yesSteps,
            };

            GenerateEventArcTrigger({ location, projectId, reactflowDefinition, serviceAccount });

            GCPworkflowDefinition[uniqueCatalogSub] = GenerateWhatsAPPCatalogSteps(node, uniqueCatalogYes, uniqueTextName, message_id, args);
            GCPworkflowDefinition.message_await_callback_event = GenerateWaitCallbackStep;
            return addMainStepCatalog(node, node.data.title, uniqueCatalogSub, workflowTitle, steps, args, node.data.form_payload.is_response_wait);
        }

        async function handleUtilsFunctionNode(node, message_id, uniqueTextName, workflowTitle) {
            let steps = [];
            const uniqueUtilsSub = `utilsFunctionNode_${message_id}`;

            const yesEdge = findEdge(reactflowDefinition, node.id, "next-step");
            const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);

            const uniqueUtilsYes = `UtilsYesPSWF_${message_id}`;

            // GCPworkflowDefinition[uniqueUtilsYes] = {
            //     params: Array.from(new Set([...Object.keys(args), node.data.title])),
            //     steps: yesSteps,
            // };

            // GCPworkflowDefinition[uniqueUtilsSub] = GenerateUtilsFunctionSteps(node, uniqueUtilsYes, node.data.function, args)
            return addMainStepUtils(node, uniqueTextName, node.data.function, yesSteps, steps);
        }

        async function handleSubflowNode(node, message_id, nodeTitle) {
            let steps = [];
            const yesEdge = findEdge(reactflowDefinition, node.id, "next-step");
            const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);
            // let subflowId = node.data.subflow ?? '';

            // const subflow = await SubflowModel.findById(subflowId);
            // if (projectId && location) {
            //     // Remove spaces from the title and branch_id when generating the specifiedName
            //     const specifiedName = ('Subflow_' + subflow?._id + '_' + reactflowDefinition.branch_id).replace(/\s+/g, '_');
            //     const gcpWflow = await getWorkflow(specifiedName);
            //     // Check if the workflow already exists

            //     if (gcpWflow) {
            //         logger.log('info', 'subworkflow already exists');
            //         const response = await CreateGCPSubflowDefinition(subflow, reactflowDefinition.organisation_id, reactflowDefinition.branch_id, { mainflow: args });
            //         // logger.log('info', JSON.stringify(response));
            //         await updateGCPWorkflowSource(projectId, location, specifiedName, response);
            //     } else {
            //         const response = await CreateGCPSubflowDefinition(subflow, reactflowDefinition.organisation_id, reactflowDefinition.branch_id, { mainflow: args });
            //         // logger.log('info', JSON.stringify(response));
            //         await createGCPWorkflow(projectId, location, specifiedName, response, subflow?.description ?? '');
            //     }
            // }
            return addMainStepSubflow(node, nodeTitle, yesSteps, steps);
        }

        async function handleInternalAlertNode(node, message_id, workflowTitle, uniqueTextName) {
            let steps = [];
            const Buttons = node.data.form_payload.buttons || [];
            /**
         * ian stands for internal alert node
         * iaNPSW stands for internal alert No path subworkflow
         * iaNxtPSW stands for internal alert Next path subworkflow
         */
            const uniqueButtonSub = `ian_${message_id}`;
            const uniqueTextNo = `iaNPSWF_${message_id}`;
            const uniqueTextNext = `iaNxtPSWF_${message_id}`;
            // the line below is the error coming from
            if (node.data.meta_payload.components.find((comp) => comp.type === "body")?.parameters) {
                node.data.meta_payload.components.find((comp) => comp.type === "body").parameters = Generate_template_variables(node, "body");
            }
            if (node.data.meta_payload.components.find((comp) => comp.type === "header")?.parameters) {
                node.data.meta_payload.components.find((comp) => comp.type === "header").parameters = Generate_template_variables(node, "header");
            }
            if (node.data.meta_payload.components.find((comp) => comp.type === "button")?.parameters) {
                node.data.meta_payload.components.find((comp) => comp.type === "button").parameters = Generate_template_variables(node, "button");
            }
            node.data.form_payload.template = null;
            // const YesSteps = Buttons.map((button) => {
            //     return {
            //         button: button.id.replace(/[^a-zA-Z0-9]/g, ''),
            //         org_button_id: button.id,
            //         title: button.title,
            //         edge: reactflowDefinition.fe_flow.edges.find(
            //             (edge) => edge.source === node.id && edge.sourceHandle === button.id // use the correctly formatted sourceHandle
            //         ),
            //     };
            // });
            const nextEdge = findEdge(reactflowDefinition, node.id, "next-step");
            const nextSteps = await getStepsForEdge(reactflowDefinition, nextEdge, processNode, node.data.title);
            GCPworkflowDefinition[uniqueTextNext] = {
                params: Array.from(new Set([...Object.keys(args)])),
                steps: nextSteps,
            };
            // const noEdge = findEdge(reactflowDefinition, node.id, 'no-response');
            // const noSteps = await getStepsForEdge(reactflowDefinition, noEdge, processNode, node.data.title);
            // GCPworkflowDefinition[uniqueTextNo] = {
            //     params: Array.from(new Set([...Object.keys(args), node.data.title])),
            //     steps: noSteps,
            // };

            // GenerateEventArcTrigger({ location, projectId, reactflowDefinition, serviceAccount });

            // for (let i = 0; i < YesSteps.length; i++) {
            //     const YesStep = YesSteps[i];
            //     const [buttonName, id] = YesStep.org_button_id.split('-');
            //     if (YesStep.edge) {
            //         const yesEdge = findEdge(reactflowDefinition, node.id, buttonName);
            //         const yesSteps = await getStepsForEdge(reactflowDefinition, yesEdge, processNode, node.data.title);
            //         GCPworkflowDefinition[`call${YesStep.button}PSWF_${message_id}`] = {
            //             params: Object.keys(args),
            //             steps: yesSteps,
            //         };
            //     } else {
            //         GCPworkflowDefinition[`call${YesStep.button}PSWF_${message_id}`] = {
            //             params: Object.keys(args),
            //             steps: [
            //                 {
            //                     return_default: {
            //                         return: `No further steps defined for ${YesStep.button}`,
            //                     },
            //                 },
            //             ],
            //         };
            //     }
            // }
            return addMainStepAlert(uniqueTextName, node, steps, uniqueTextNext, message_id);
        }
        /**
     * Handles the processing of a default node.
     * @param node - The default node to process.
     * @returns A promise that resolves to an array of steps.
     */
        async function handleDefaultNode(node, isInsideLoop, message_id) {
            if (isInsideLoop === false) {
                return [
                    {
                        [`fn_${message_id}`]: {
                            return: node.data.title ? `\${${node.data.title}}` : "NRA",
                        },
                    },
                ];
            } else {
                return [
                    {
                        [`fn_${message_id}`]: {
                            return: "NRA",
                        },
                    },
                ];
            }
        }

        /**
     * Adds a main step to the GCP workflow definition.
     * @param index - The index of the node in the workflow.
     * @param uniqueTextName - The unique name for the text node.
     * @param uniqueTextSubName - The unique name for the subworkflow.
     * @param node - The node to process.
     * @param workflowTitle - The title of the workflow.
     * @param steps - The steps to add.
     * @returns An array of steps.
     */
        function addMainStep(uniqueTextName, uniqueTextSubName, node, workflowTitle, steps, applyDefaultDelay, args) {
            const randId = Math.floor(1000 + Math.random() * 9000).toString();
            if (node.data.form_payload) {
                delete node.data.form_payload.invalid_message;
                delete node.data.form_payload.body_variables;
                delete node.data.form_payload.template;
                delete node.data.form_payload.header_variable_data;
                delete node.data.form_payload.description;
            }
            if (node.data.sample_payload) {
                delete node.data.sample_payload;
            }
            if (node.data.errors) {
                delete node.data.errors;
            }

            let whatsappStep = {
                [uniqueTextName]: {
                    call: uniqueTextSubName,
                    args: {
                        sendUrl: environment.WHATSAPP_SEND_UTIL,
                        token: generate_jwt(node.data.organisation_id, node.data.branch_id),
                        data: node.data,
                        callbackEventSource: `T${workflowTitle}`,
                        seconds: applyDefaultDelay ? 7200 : getwait_time(node.data.form_payload),
                        executionId: "${exeId}",
                        ...args,
                    },
                    result: uniqueTextName,
                },
            };

            steps.push(whatsappStep);
            lastNodeResult = uniqueTextName;
            return steps;
        }

        function addMainStepTextNode(
            uniqueTextName,
            uniqueTextSubName,
            node,
            workflowTitle,
            steps,
            applyDefaultDelay,
            args,
            yesSteps,
            noSteps,
            _message_id
        ) {
            let message_id = Math.floor(1000 + Math.random() * 9000).toString();
            if (node.data.form_payload) {
                delete node.data.form_payload.invalid_message;
                delete node.data.form_payload.body_variables;
                delete node.data.form_payload.template;
                delete node.data.form_payload.header_variable_data;
                delete node.data.form_payload.description;
            }
            if (node.data.errors) {
                delete node.data.errors;
            }
            let whatsapptextsteps = [
                {
                    [`s_m_${message_id}`]: {
                        call: "http.post",
                        args: {
                            url: environment.WHATSAPP_SEND_UTIL,
                            headers: {
                                "X-Auth-Token": generate_jwt(node.data.organisation_id, node.data.branch_id),
                                "Content-Type": "application/json",
                                "execution-id": "${exeId}",
                            },
                            body: node.data,
                        },
                        result: "whatsappTextResult",
                    },
                },
            ];
            if (node.data.form_payload.is_response_wait) {
                whatsapptextsteps.push(
                    {
                        [`a_t_${message_id}`]: {
                            assign: [
                                {
                                    n: 0,
                                },
                            ],
                        }
                    },
                    {
                        [`m_a_c_evnt_${message_id}`]: {
                            call: "message_await_callback_event",
                            args: {
                                event_source: `T${workflowTitle}`,
                                seconds: applyDefaultDelay ? 7200 : getwait_time(node.data.form_payload),
                                executionId: "${exeId}",
                            },
                            result: "cbR",
                        },
                    },
                    {
                        [`s_r_${message_id}`]: {
                            assign: [
                                {
                                    [uniqueTextName]: "${cbR}",
                                },
                            ],
                        },
                    }
                );

                if (node.data.form_payload.is_check_format) {
                    whatsapptextsteps.push(
                        {
                            [`i_t_${message_id}`]: {
                                assign: [
                                    {
                                        n: "${n + 1}",
                                    },
                                ],
                            }
                        },
                        {
                            [`v_r_${message_id}`]: {
                                switch: [
                                    {
                                        condition:
                                        "${cbR.success == true and " +
                                        node.data.form_payload.is_check_format +
                                        "== true and cbR.message_id == whatsappTextResult.body.messages[0].id and cbR.type == \"" +
                                        node.data.form_payload.format_unit +
                                        "\"}",
                                        next: `yesStep_${message_id}`,
                                    },
                                    {
                                        condition:
                                        "${cbR.success == true and " +
                                        node.data.form_payload.is_check_format +
                                        "== true and cbR.message_id == whatsappTextResult.body.messages[0].id and cbR.type != \"" +
                                        node.data.form_payload.format_unit +
                                        "\"}",
                                        steps: [
                                            {
                                                [`c_t_o_${message_id}`]:{
                                                    switch:[
                                                        {
                                                            condition: "${n < 5}",
                                                            steps: [
                                                                {
                                                                    [`s_n_${message_id}`]: {
                                                                        call: "http.post",
                                                                        args: {
                                                                            url: environment.WHATSAPP_SEND_INVALID,
                                                                            headers: {
                                                                                "X-Auth-Token": generate_jwt(node.data.organisation_id, node.data.branch_id),
                                                                                "Content-Type": "application/json",
                                                                                "execution-id": "${exeId}",
                                                                            },
                                                                            body: node.data,
                                                                        },
                                                                        result: "InvalidResult",
                                                                    },
                                                                },
                                                                {
                                                                    [`call_m_a_c_${message_id}`]: {
                                                                        next: `m_a_c_evnt_${message_id}`,
                                                                    }
                                                                }
                                                            ]
                                                    
                                                        },
                                                        {
                                                            condition: "${n >= 5}",
                                                            next: `noStep_${message_id}`,
                                                        }
                                                    ]
                                                }
                                            }
                                        ]
                                    },
                                    {
                                        condition: "${cbR.success != true or cbR.message_id != whatsappTextResult.body.messages[0].id}",
                                        next: `noStep_${message_id}`,
                                    },
                                ],
                            },
                        },
                        {
                            [`yesStep_${message_id}`]: {
                                steps: yesSteps,
                                next: `lastone_${message_id}`,
                            },
                        },
                        {
                            [`noStep_${message_id}`]: {
                                steps: noSteps,
                                next: `lastone_${message_id}`,
                            },
                        },
                        {
                            [`lastone_${message_id}`]: {
                                return: "default",
                            },
                        }
                    );
                } else if (node.data.form_payload.response_wait) {
                    whatsapptextsteps.push({
                        [`v_r_${message_id}`]: {
                            switch: [
                                {
                                    condition: "${cbR.success == true and " + node.data.form_payload.is_check_format + " == false and cbR.message_id == whatsappTextResult.body.messages[0].id}",
                                    steps: yesSteps,
                                },
                                {
                                    condition: "${cbR.success != true or cbR.message_id != whatsappTextResult.body.messages[0].id}",
                                    steps: noSteps,
                                },
                            ],
                        },
                    });
                } else {
                    whatsapptextsteps.push(...yesSteps);
                }
            } else {
                whatsapptextsteps.push(
                    {
                        [`s_r_${message_id}`]: {
                            assign: [
                                {
                                    [uniqueTextName]: "${whatsappTextResult}",
                                },
                            ],
                        },
                    },
                    ...yesSteps
                );
            }
            let whatsappStep = {
                [uniqueTextName]: {
                    steps: whatsapptextsteps,
                },
            };

            steps.push(whatsappStep);
            lastNodeResult = uniqueTextName;
            return steps;
        }

        function addMainStepDelay(node, delayArgs, nodeTitle, yesSteps, message_id, steps) {
            let dly_message_id = Math.floor(1000 + Math.random() * 9000).toString();
            let delayStep = {
                [nodeTitle]: {
                    steps: [
                        {
                            [`dly_${dly_message_id}`]: {
                                call: "sys.sleep",
                                args: delayArgs,
                                result: "DelayNodeResult",
                            },
                        },
                        ...yesSteps,
                    ],
                },
            };
            if(node.data.is_delayed_until || node.data.is_delayed_until_dynamic){
                delayStep = {
                    [nodeTitle]: {
                        steps: [
                            {
                                [`dly_${dly_message_id}`]: {
                                    call: "sys.sleep_until",
                                    args: delayArgs,
                                    result: "DelayNodeResult",
                                },
                            },
                            ...yesSteps,
                        ],
                    },
                };
            }
            steps.push(delayStep);
            lastNodeResult = nodeTitle;
            return steps;
        }

        function addMainStepConditionalSplit(uniqueStepName, uniqueSubStepName, steps, dataArg, conditionsArg, filterGroupCondition, yesSteps, noSteps, args) {
            const delayStep = {
                [uniqueStepName]: {
                    steps: [
                        {
                            [`cfn_${uniqueStepName}`]: {
                                call: "http.post",
                                args: {
                                    url: `${environment.GCP_FUNCTION_URL}/condition_split`,
                                    headers: {
                                        "Content-Type": "application/json",
                                    },
                                    body: {
                                        data: dataArg,
                                        filterGroupCondition: filterGroupCondition,
                                        conditions: conditionsArg,
                                    },
                                },
                                result: "cloudFunctionResult",
                            },
                        },
                        {
                            [`l_c_r_${uniqueStepName}`]: {
                                call: "sys.log",
                                args: {
                                    severity: "INFO",
                                    data: "${cloudFunctionResult}",
                                },
                            },
                        },
                        {
                            [`rP_${uniqueStepName}`]: {
                                switch: [
                                    {
                                        condition: "${cloudFunctionResult.body == \"yes\"}",
                                        steps: yesSteps,
                                    },
                                    {
                                        condition: "${cloudFunctionResult.body == \"no\"}",
                                        steps: noSteps,
                                    },
                                ],
                            },
                        },
                    ],
                },
            };
            steps.push(delayStep);
            lastNodeResult = uniqueStepName;
            return steps;
        }

        function addMainStepConditionalBranch(uniqueStepName, uniqueSubStepName, steps, dataArg, paths, args) {
            const delayStep = {
                [uniqueStepName]: {
                    call: uniqueSubStepName,
                    args: {
                        data: dataArg,
                        paths: paths,
                        ...args,
                    },
                    result: uniqueStepName,
                },
            };
            steps.push(delayStep);
            lastNodeResult = uniqueStepName;
            return steps;
        }

        function addMainStepSaveVariable(node, nodeTitle, steps, variableObject, yesSteps, args) {
            const delayStep = {
                [nodeTitle]: {
                    steps: [
                        {
                            saveVariableObject: {
                                assign: [
                                    {
                                        [nodeTitle]: variableObject,
                                    },
                                ],
                            },
                        },
                        ...yesSteps,
                    ],
                },
            };
            steps.push(delayStep);
            lastNodeResult = nodeTitle;
            return steps;
        }

        function addMainStepSaveData(nodeTitle, graphqlMutation, graphqlVariables, yesSteps, steps, args) {
            let _id = Math.floor(1000 + Math.random() * 9000).toString();
            const saveDataStep = {
                [nodeTitle]: {
                    steps: [
                        {
                            [`saveData_${_id}`]: {
                                call: "http.post", // Assuming an HTTP POST call to a GraphQL endpoint
                                args: {
                                    url: `${environment.FLOW_SERVICE_SEND_UTIL}/graphql`, // Your GraphQL endpoint
                                    headers: {
                                        "Content-Type": "application/json",
                                        "organisation-id": reactflowDefinition.organisation_id,
                                        "branch-id": reactflowDefinition.branch_id,
                                    },
                                    body: {
                                        query: graphqlMutation,
                                        variables: graphqlVariables,
                                    },
                                },
                                result: nodeTitle,
                            },
                        },
                        ...yesSteps,
                    ],
                },
            };

            steps.push(saveDataStep);
            lastNodeResult = nodeTitle;
            return steps;
        }

        function addMainStepLoop(uniqueStepName, uniqueSubStepName, loopValue, loopLimit, node, steps, args) {
            const delayStep = {
                [uniqueStepName]: {
                    call: uniqueSubStepName,
                    args: {
                        loopValue: loopValue,
                        loopLimit: loopLimit,
                        ...args,
                    },
                    result: uniqueStepName,
                },
            };
            steps.push(delayStep);
            lastNodeResult = uniqueStepName;
            return steps;
        }

        function addMainAPIStep(node, nodeTitle, _message_id, steps, yesSteps, args) {
            let message_id = Math.floor(1000 + Math.random() * 9000).toString();
            const api_type = node.data.api_type;
            const api_event = node.data.api_event;
            if (node.data.sample_payload) {
                delete node.data.sample_payload;
            }
            if (node.data.errors) {
                delete node.data.errors;
            }
            if (node.data.description) {
                delete node.data.description;
            }
            const url = `${environment.FLOW_SERVICE_SEND_UTIL}/${api_type}/${api_event}`;
            let assign_name = GenerateNodeTitle(nodeTitle, "apiNode");
            const apiStep = {
                [nodeTitle]: {
                    steps: [
                        {
                            [`s_m_${message_id}`]: {
                                call: "http.post",
                                args: {
                                    url: url,
                                    headers: {
                                        "X-Auth-Token": generate_jwt(node.data.organisation_id, node.data.branch_id),
                                        "Content-Type": "application/json",
                                    },
                                    body: { ...node.data },
                                },
                                result: "apiNodeResult",
                            },
                        },
                        {
                            [`a_r_${message_id}`]: {
                                assign: [
                                    {
                                        [assign_name]: "${apiNodeResult.body}",
                                    },
                                ],
                            },
                        },
                        ...yesSteps,
                    ],
                },
            };
            steps.push(apiStep);
            lastNodeResult = nodeTitle;
            console.log(JSON.stringify(steps));
            return steps;
        }

        function addMainStepWebhook(uniqueStepName, uniqueSubStepName, steps, args) {
            const saveDataStep = {
                [uniqueStepName]: {
                    call: uniqueSubStepName,
                    args: {
                        executionId: "${exeId}",
                        ...args,
                    },
                    result: uniqueStepName,
                },
            };

            steps.push(saveDataStep);
            lastNodeResult = uniqueStepName;
            return steps;
        }

        function addMainStepCatalog(node, uniqueStepName, uniqueSubStepName, workflowTitle, steps, args, applyDelay) {
            const catalogStep = {
                [uniqueStepName]: {
                    call: uniqueSubStepName,
                    args: {
                        sendUrl: environment.WHATSAPP_SEND_UTIL,
                        token: generate_jwt(node.data.organisation_id, node.data.branch_id),
                        data: node.data,
                        callbackEventSource: `T${workflowTitle}`,
                        seconds: applyDelay ? getwait_time(node.data.form_payload) : 7200,
                        executionId: "${exeId}",
                        ...args,
                    },
                    result: uniqueStepName,
                },
            };

            steps.push(catalogStep);
            lastNodeResult = uniqueStepName;
            return steps;
        }

        function addMainStepUtils(node, nodeTitle, functionName, yesSteps, steps) {
            const catalogStep = {
                [nodeTitle]: {
                    steps: [
                        {
                            ccf: {
                            // ccf stands for Cloud Call Function
                                call: "http.post",
                                args: {
                                    url: `${environment.GCP_FUNCTION_URL}/${functionName}`,
                                    headers: {
                                        "Content-Type": "application/json",
                                    },
                                    body: {
                                        source: transformPlaceholders(node.data.source),
                                        target: node.data.target,
                                    },
                                },
                                result: "cloudFunctionResult",
                            },
                        },
                        {
                            s_r: {
                                assign: [
                                    {
                                        [nodeTitle]: "${cloudFunctionResult.body}",
                                    },
                                ],
                            },
                        },
                        ...yesSteps,
                    ],
                },
            };

            steps.push(catalogStep);
            lastNodeResult = nodeTitle;
            return steps;
        }

        function addMainStepSubflow(node, nodeTitle, yesSteps, steps) {
            const subCallId = Math.floor(1000 + Math.random() * 9000).toString();
            const catalogStep = {
                [nodeTitle]: {
                    steps: [
                        {
                            [`g_e${subCallId}`]: {
                                call: "sys.get_env",
                                args: {
                                    name: "GOOGLE_CLOUD_WORKFLOW_EXECUTION_ID",
                                },
                                result: "executionId",
                            },
                        },
                        {
                            [`subE${subCallId}`]: {
                                call: "http.post",
                                args: {
                                    url: `${environment.GCP_SUBFLOW_FUNCTION_URL}`,
                                    headers: {
                                        "Content-Type": "application/json",
                                    },
                                    body: {
                                        workflow_id: `Subflow_${node.data.subflow}_${reactflowDefinition.branch_id}`,
                                        argument: {
                                            mainflow: args,
                                            executionId: "${executionId}",
                                        },
                                        location: "${tg.workflow.location}"
                                    },
                                },
                                result: "cloudFunctionResult",
                            },
                        },
                        {
                            [`tS${subCallId}`]: {
                                call: "text.split",
                                args: {
                                    source: "${cloudFunctionResult.body.execData}",
                                    separator: "/",
                                },
                                result: "subExecId",
                            },
                        },
                        {
                            [`gP${subCallId}`]: {
                                call: "sys.get_env",
                                args: {
                                    name: "GOOGLE_CLOUD_PROJECT_ID",
                                },
                                result: "projectId",
                            },
                        },
                        {
                            [`init_f${subCallId}`]: {
                                assign: [
                                    {
                                        database_root: "${\"projects/\" + projectId + \"/databases/flowflex/documents/subflows/\"}",
                                    },
                                    {
                                        subflow_name: `Subflow_${node.data.subflow}_${reactflowDefinition.branch_id}_`,
                                    },
                                    {
                                        doc_name: "${database_root + subflow_name + subExecId[7]}",
                                    },
                                    {
                                        firestore_key: "${subflow_name}",
                                    },
                                    {
                                        execStatus: "pending",
                                    },
                                    {
                                        execData: "${tg}",
                                    },
                                ],
                            },
                        },
                        {
                            [`scURL${subCallId}`]: {
                                call: "googleapis.firestore.v1.projects.databases.documents.patch",
                                args: {
                                    name: "${doc_name}",
                                    updateMask: {
                                        fieldPaths: ["status", "data"],
                                    },
                                    body: {
                                        fields: {
                                            status: {
                                                stringValue: "pending",
                                            },
                                            data: {
                                                stringValue: "${json.encode_to_string(tg)}",
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        {
                            [`exeStatus${subCallId}`]: {
                                switch: [
                                    {
                                        condition: "${execStatus == \"pending\"}",
                                        steps: [
                                            {
                                                [`get${subCallId}`]: {
                                                    call: "googleapis.firestore.v1.projects.databases.documents.get",
                                                    args: {
                                                        name: "${doc_name}",
                                                        mask: {
                                                            fieldPaths: ["status", "data"],
                                                        },
                                                    },
                                                    result: "getResult",
                                                },
                                            },
                                            {
                                                [`setExecStatus${subCallId}`]: {
                                                    assign: [
                                                        {
                                                            execStatus: "${getResult.fields.status.stringValue}",
                                                        },
                                                        {
                                                            execData: "${getResult.fields.data.stringValue}",
                                                        },
                                                    ],
                                                },
                                            },
                                            {
                                                [`sBRtry${subCallId}`]: {
                                                    call: "sys.sleep",
                                                    args: {
                                                        seconds: 3600,
                                                    },
                                                },
                                            },
                                            {
                                                [`goto${subCallId}`]: {
                                                    next: `exeStatus${subCallId}`,
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                        {
                            [`dt_c${subCallId}`]: {
                                call: "googleapis.firestore.v1.projects.databases.documents.delete",
                                args: {
                                    name: "${doc_name}",
                                },
                            },
                        },
                        {
                            [`s_r${subCallId}`]: {
                                assign: [
                                    {
                                        [nodeTitle]: "${json.decode(execData)}",
                                    },
                                ],
                            },
                        },
                        {
                            [`p_f${subCallId}`]: {
                                call: "http.post",
                                args: {
                                    url: `${environment.WHATSAPP_SESSION_CLEAR}`,
                                    headers: {
                                        "Content-Type": "application/json",
                                    },
                                    body: {
                                        execution_id: "${subExecId[7]}",
                                        branch_id: reactflowDefinition.branch_id,
                                    },
                                },
                            },
                        },
                        ...yesSteps,
                    ],
                },
            };
            steps.push(catalogStep);
            lastNodeResult = nodeTitle;
            return steps;
        }

        function addMainStepAlert(
            uniqueTextName,
            node,
            steps,
            yesStep,
            _message_id
        ) {
            let message_id = Math.floor(1000 + Math.random() * 9000).toString();
            if (node.data.form_payload) {
                delete node.data.form_payload.invalid_message;
                delete node.data.form_payload.body_variables;
                delete node.data.form_payload.template;
                delete node.data.form_payload.header_variable_data;
                delete node.data.form_payload.description;
                delete node.data.form_payload.channel;
            }
            if (node.data.errors) {
                delete node.data.errors;
            }
            let alertsteps = [
                {
                    [`s_m_${message_id}`]: {
                        call: "http.post",
                        args: {
                            url: environment.WHATSAPP_SEND_ALERT,
                            headers: {
                                "X-Auth-Token": generate_jwt(node.data.organisation_id, node.data.branch_id),
                                "Content-Type": "application/json",
                                "execution-id": "${exeId}",
                            },
                            body: node.data,
                        },
                        result: "alertResult",
                    },
                },
                {
                    [`call_${yesStep}`]: {
                        call: yesStep,
                        args: args,
                        result: `${yesStep}PathResult`,
                    },
                },
            ];
            let alertStep = {
                [uniqueTextName]: {
                    steps: alertsteps,
                },
            };

            steps.push(alertStep);
            lastNodeResult = uniqueTextName;
            return steps;
        }

        await processNode(currentNode);
        GCPworkflowDefinition.main.steps.push(
            {
                p_f: {
                    call: "http.post",
                    args: {
                        url: `${environment.WHATSAPP_SESSION_CLEAR}`,
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: {
                            execution_id: "${exeId}",
                            branch_id: reactflowDefinition.branch_id,
                        },
                    },
                },
            },
            {
                W_f: {
                    return: lastNodeResult ? "${tg}" : "NRA",
                },
            }
        );
        return GCPworkflowDefinition;
    }
}