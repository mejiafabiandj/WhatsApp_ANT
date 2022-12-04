"use strict";

const { SessionsClient } = require('@google-cloud/dialogflow-cx');
require('dotenv').config();

// Access token for your app
// (copy token from DevX getting started page
// and save it as environment variable into the .env file)
const TOKEN = process.env.WHATSAPP_TOKEN;
const projectId = process.env.DIALOGFLOW_PROJECT_ID;
const location = process.env.DIALOGFLOW_PROJECT_LOCATION;
const agentId = process.env.DIALOGFLOW_AGENT_ID;
const languageCode = process.env.DIALOGFLOW_LANGUAGE_CODE;

const MIN_TYPING_TIME = 200;
const MAX_TYPING_TIME = 800;

const dialogFlowClient = new SessionsClient();

var actionsMap = {};


// Imports dependencies and set up http server
const request = require("request"),
    express = require("express"),
    body_parser = require("body-parser"),
    axios = require("axios").default,
    FormData = require('form-data'),
    app = express().use(body_parser.json()), // creates express http server
    fs = require('fs'),
    randomstring = require('randomstring'),
    PDFDocument = require('pdfkit'),
    { RateLimiterMemory, RateLimiterRes } = require('rate-limiter-flexible');



const rateLimiter = new RateLimiterMemory({ points: process.env.RATE_LIMITS_POINTS, duration: process.env.RATE_LIMITS_DURATION });
var blacklist = {};

// Sets server port and logs message on success
app.listen(process.env.PORT || 1337, () => console.log("webhook is listening"));


app.get("/", (req, res) => {
    console.log("ok");
    res.status(200).send("ok");
});


// Accepts GET requests at the /webhook endpoint. You need this URL to setup webhook initially.
// info on verification request payload: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests 
app.get("/webhook", (req, res) => {
    /**
     * UPDATE YOUR VERIFY TOKEN
     *This will be the Verify Token value when you set up webhook
    **/
    const verify_token = process.env.VERIFY_TOKEN;

    // Parse params from the webhook verification request
    let mode = req.query["hub.mode"];
    let token = req.query["hub.verify_token"];
    let challenge = req.query["hub.challenge"];

    // Check if a token and mode were sent
    if (mode && token) {
        // Check the mode and token sent are correct
        if (mode === "subscribe" && token === verify_token) {
            // Respond with 200 OK and challenge token from the request
            console.log("WEBHOOK_VERIFIED");
            res.status(200).send(challenge);
        } else {
            // Responds with '403 Forbidden' if verify tokens do not match
            res.sendStatus(403);
        }
    }
});


// Accepts POST requests at /webhook endpoint
app.post("/webhook", (req, res) => {
    // Parse the request body from the POST
    let body = req.body;

    // Check the Incoming webhook message
    //console.log(JSON.stringify(req.body, null, 2));

    // info on WhatsApp text message payload: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples#text-messages
    if (req.body.object) {
        if (
            req.body.entry &&
            req.body.entry[0].changes &&
            req.body.entry[0].changes[0] &&
            req.body.entry[0].changes[0].value.messages
        ) {
            let phone_number_id = req.body.entry[0].changes[0].value.metadata.phone_number_id;

            for (let message of req.body.entry[0].changes[0].value.messages) {
                console.log(message);
                let from = message.from; // extract the phone number from the webhook payload

                rateLimiter.consume(from, 1)
                    .then((rateLimiterRes) => {
                        if (blacklist[from]) {
                            
                            let currentTimestamp = new Date();
                            let bannedTimestamp = blacklist[from].bannedTimestamp;
                            let diff = currentTimestamp - bannedTimestamp;

                            //is still banned
                            if ((diff / (1000 * 60)) < process.env.BANN_DURATION) {
                                let lastResponse = blacklist[from].lastResponse;

                                console.log(2, (currentTimestamp - lastResponse));

                                if (((currentTimestamp - lastResponse) / (1000)) < process.env.BANN_MIN_RESPONSE_TIME) {
                                    //do nothing
                                } else {
                                    blacklist[from].lastResponse = new Date();
                                    let remainingTimeToUnbann = process.env.BANN_DURATION - Math.round(diff / (1000 * 60));
                                    sendMessage(phone_number_id, from, "Ha enviado muchos mensajes en un corto periodo de tiempo, por favor espere " + remainingTimeToUnbann + " minuto(s) para ponerse nuevamente en contacto con nosotros.");
                                }
                                return;
                            } else {
                                console.log(3, "removed!!!", blacklist[from]);
                                //remove user from blacklist
                                blacklist[from] = null;
                            }
                        }

                        if (actionsMap[from] == "GuardarAudioSiguienteInteraccion" && message.audio) {

                            //save audio to local file
                            downloadMedia(message.audio.id).then(function (media) {

                                //Why not to use ws audio id as filename?
                                let file_id = randomstring.generate();
                                fs.writeFileSync("./data/attachments/audio/" + file_id + ".ogg", media.data, "base64");

                                analyzeMessage("Guardado audio " + media.file_size + " segundos,  archivo id " + file_id, from).then(function (results) {
                                    if (results && results[0] && results[0].queryResult) {
                                        proccessDialogFlowResults(phone_number_id, from, results);
                                    } else {
                                        sendMessage(phone_number_id, from, "El mensaje no pudo ser procesado, por favor verifca la información suministrada");
                                    }
                                });
                            });
                        } else if (actionsMap[from] == "GuardarUbicacionSiguienteInteraccion" && message.location) {

                            analyzeMessage("latitud " + message.location.latitude + " longitud " + message.location.longitude, from).then(function (results) {
                                if (results && results[0] && results[0].queryResult) {
                                    proccessDialogFlowResults(phone_number_id, from, results);
                                } else {
                                    sendMessage(phone_number_id, from, "El mensaje no pudo ser procesado, por favor verifca la información suministrada");
                                }
                            });
                        } else {
                            if (message.type == "text" || message.type == "interactive") {
                                let msg_body;
                                if (message.text) {
                                    msg_body = message.text.body;
                                } else if (message.interactive) {
                                    if (message.interactive.type == "button_reply") {
                                        msg_body = message.interactive.button_reply.title;
                                    } else {
                                        //TODO: handle list responses
                                        console.error("other Interactive not supported yet!");
                                    }
                                }

                                if (msg_body == "!pdf") {
                                    sendMessage(phone_number_id, from, "aca va un pdf!!");
                                } else {
                                    analyzeMessage(msg_body, from).then(function (results) {
                                        // use the result here
                                        if (results && results[0] && results[0].queryResult) {
                                            proccessDialogFlowResults(phone_number_id, from, results);
                                        } else {
                                            sendMessage(phone_number_id, from, "El mensaje no pudo ser procesado, por favor verifca la información suministrada");
                                        }
                                    });
                                }
                            } else if (message.type == "audio" && message.audio.id) {
                                console.log(message);
                                downloadMedia(message.audio.id).then(function (media) {

                                    analyzeVoiceMessage(media.data, from).then(function (results) {
                                        if (results && results[0] && results[0].queryResult) {
                                            proccessDialogFlowResults(phone_number_id, from, results);
                                        } else {
                                            sendMessage(phone_number_id, from, "El mensaje de audio no pudo ser procesado, por favor verifca la información suministrada");
                                        }
                                    });

                                }).catch(function (error) {
                                    console.log(error);
                                });
                            }
                        }
                    })
                    .catch((rateLimiterRes) => {
                        // Not enough points to consume
                        if (!blacklist[from]) {
                            blacklist[from] = { bannedTimestamp: new Date(), lastResponse: new Date() };

                            sendMessage(phone_number_id, from, "Ha enviado muchos mensajes al sistema");
                        }
                    });
            }
        }
        //always reutn 200 to Facebook webhook 
        res.sendStatus(200);
    } else {
        // Return a '404 Not Found' if event is not from a WhatsApp API
        res.sendStatus(404);
    }
});


async function sendMessage(from_id, to, msg) {
    axios({
        method: "POST", // Required, HTTP method, a string, e.g. POST, GET
        url:
            "https://graph.facebook.com/v12.0/" +
            from_id +
            "/messages?access_token=" +
            TOKEN,
        data: {
            messaging_product: "whatsapp",
            to: to,
            text: { body: msg },
        },
        headers: { "Content-Type": "application/json" },
    });
}


async function sendButtons(from_id, to, body, buttons, header = null, footer = null) {
    axios({
        method: "POST", // Required, HTTP method, a string, e.g. POST, GET
        url:
            "https://graph.facebook.com/v12.0/" +
            from_id +
            "/messages?access_token=" +
            TOKEN,
        data: {
            messaging_product: "whatsapp",
            to: to,
            type: "interactive",
            interactive: {
                type: "button",
                body: { text: body },
                header: (header ? { type: "text", text: header } : null),
                footer: (footer ? { text: footer } : null),
                action: {
                    buttons: buttons
                }
            }
        },
        headers: { "Content-Type": "application/json" },
    });
}


function downloadMedia(mediaId) {
    return new Promise((resolve, reject) => {
        axios({
            method: "GET", // Required, HTTP method, a string, e.g. POST, GET
            url:
                "https://graph.facebook.com/v12.0/" + mediaId +
                "/?access_token=" +
                TOKEN,
            headers: { "Content-Type": "application/json" },
        }).then(function (response) {
            if (response.data && response.data.url) {

                axios({
                    method: "GET", // Required, HTTP method, a string, e.g. POST, GET
                    url: response.data.url,
                    responseType: "arrayBuffer",
                    responseEncoding: "binary",
                    headers: { "Authorization": "Bearer " + TOKEN },
                }).then(function (media) {
                    let buffer = Buffer.from(media.data, 'binary');
                    let data = response.data;
                    data.data = buffer
                    resolve(data);

                }).catch(function (error) {
                    // handle error
                    console.log(error);
                    reject(error);
                });
            } else {
                reject("No media url found");

            }

        }).catch(function (error) {
            console.log(error);
            reject(error);
        });
    });
}


function uploadMedia(mediaURL, from_id) {
    return new Promise((resolve, reject) => {
        var data = new FormData();
        data.append('messaging_product', 'whatsapp');
        data.append('file', fs.createReadStream(mediaURL));

        var config = {
            method: 'post',
            url: 'https://graph.facebook.com/v12.0/' + from_id + '/media',
            headers: {
                'Authorization': 'Bearer ' + TOKEN,
                ...data.getHeaders()
            },
            data: data
        };

        axios(config)
            .then(function (response) {
                if (response.data) {
                    resolve(response.data);
                } else {
                    reject("Erorr uploading file");
                }
            })
            .catch(function (error) {
                console.log(error);
                reject(error);
            });
    });
}



async function analyzeMessage(message, sessionId) {
    // Create a new session
    const sessionPath = dialogFlowClient.projectLocationAgentSessionPath(
        projectId,
        location,
        agentId,
        sessionId
    );
    const request = {
        session: sessionPath,
        queryInput: {
            text: {
                text: message,
            },
            languageCode,
        },
    };
    return await dialogFlowClient.detectIntent(request);
}


async function analyzeVoiceMessage(media, sessionId) {
    // Create a new session
    const sessionPath = dialogFlowClient.projectLocationAgentSessionPath(
        projectId,
        location,
        agentId,
        sessionId
    );
    const request = {
        session: sessionPath,
        queryInput: {
            audio: {
                config: {
                    audioEncoding: 'AUDIO_ENCODING_OGG_OPUS',
                    sampleRateHertz: 16000
                },
                audio: media,
            },
            languageCode,
        },
    };
    return dialogFlowClient.detectIntent(request);
}


async function proccessDialogFlowResults(from_id, to, results) {
    //console.log("dialogflow intents found", results);

    if (results[0] && results[0].queryResult) {
        const result = results[0].queryResult;

        //show audio transcript
        /*if (result.transcript) {
            sendMessage(from_id, to, "Audio recibido: _" + result.transcript + "_");
        }*/

        if (result.responseMessages) {

            processResponseAction(result, from_id, to);

            for (const responseMsg of result.responseMessages) {
                if (responseMsg.text && responseMsg.text.text) {
                    if (responseMsg.text.text[0].indexOf("!buttons:") != -1) {

                        let txt = responseMsg.text.text[0].replaceAll('!buttons:', '');
                        let obj = JSON.parse(txt);
                        let body = obj.body;
                        let footer = obj.footer;
                        let header = obj.header;
                        let buttons = [];

                        for (let btn of obj.buttons) {
                            buttons.push({
                                type: "reply",
                                reply: {
                                    id: btn.body,
                                    title: btn.body
                                }
                            });
                        }

                        sendButtons(from_id, to, body, buttons, header, footer);
                    } else {
                        sendMessage(from_id, to, responseMsg.text.text[0].replaceAll('\\\\n', '\n'));
                    }
                    //TODO: process list
                    /*
                     else if (responseMsg.text.text[0].indexOf("!list:") != -1) {
                        let txt = responseMsg.text.text[0].replaceAll('!list:', '');
                        let obj = JSON.parse(txt);

                        let list = new List(obj.body, obj.btn_text, obj.sections, obj.title, obj.footer);
                        client.sendMessage(msg.from, list);

                    } else {
                        client.sendMessage(msg.from, responseMsg.text.text[0].replaceAll('\\\\n', '\n'));
                    }
                    */
                    sleep(Math.floor(Math.random() * MAX_TYPING_TIME) + MIN_TYPING_TIME);

                } else {
                    if (responseMsg.message == "payload" && responseMsg.payload && responseMsg.payload.fields && responseMsg.payload.fields.action) {
                        switch (responseMsg.payload.fields.action.stringValue) {
                            case "save_audio":

                                actionsMap[to] = "GuardarAudioSiguienteInteraccion";
                                console.log("action setted: " + "GuardarAudioSiguienteInteraccion" + " client ID: " + to)

                                break;
                            case "save_location":

                                actionsMap[to] = "GuardarUbicacionSiguienteInteraccion";
                                console.log("action setted: " + "GuardarUbicacionSiguienteInteraccion" + " client ID: " + to)

                                break;
                        }
                    }
                }
            }

        } else {
            client.sendMessage(msg.from, "No he podido procesar tu solicitud");
        }

    } else {
        //TODO Analyze direct commands
        client.sendMessage(msg.from, "Por favor intenta ingresar nuevamente la respuesta.");
        console.log("No intents found");
    }
}

async function processResponseAction(result, from_id, to) {
    if (result.intent) {
        switch (result.intent.displayName) {
            case "formalizar.tiempo_habita_predio": {
                generateReport("formalizationResult", result.parameters.fields, from_id, to)
                break;
            }
            case "compra_tierras.confirmar.si": {
                generateReport("compraTierrasResult", result.parameters.fields, from_id, to)
                break;
            }
            case "adjudicar.confirmar.si": {
                generateReport("adjudicarResult", result.parameters.fields, from_id, to)
                break;
            }
        }
    }
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}


async function generateReport(reportName, fields, from_id, to) {
    var docId = randomstring.generate();
    var docUrl = 'data/reports/' + docId + '.pdf';

    //console.log(fields);

    switch (reportName) {
        case "formalizationResult": {

            // Create a document
            const doc = new PDFDocument({
                size: [419, 297],
                orientation: 'landscape',
                margins: {
                    top: 10,
                    bottom: 10,
                    left: 40,
                    rigth: 40
                }
            });


            // Saving the pdf file in root directory.
            doc.pipe(fs.createWriteStream(docUrl));

            // Adding an image in the pdf.
            doc.image('img/logo_agencia.png', {
                fit: [80, 80],
                x: 10,
                y: 10
            });

            doc.image('img/gobierno.png', {
                fit: [100, 100],
                x: 300,
                y: 270
            });

            doc.image('img/IWUFHC7PAPILD1.png', {
                fit: [40, 40],
                x: 360,
                y: 10
            });


            doc.moveDown()
                .fontSize(10)
                .font('Helvetica-Bold')
                .text('Número de formulario de caracterización: FC-000734', {
                    width: 340,
                    align: 'center'
                });

            doc.fontSize(8)
                .font('Helvetica').moveDown().moveDown()
                .text('Se ha registrado la siguiente información:', {
                    width: 390,
                    align: 'left'
                }).moveDown().moveDown()
                .text(`Interesado o solicitante: ${fields.nombre.stringValue}`, {
                    width: 390,
                    align: 'left'
                }).moveDown(0.5)
                .text(`Documento número: ${fields.cedula.stringValue}`, {
                    width: 390,
                    align: 'left'
                }).moveDown(0.5)
                .text(`Teléfono de contacto: ${fields.telefono.stringValue}`, {
                    width: 390,
                    align: 'left'
                }).moveDown(0.5);

            if (fields.municipio && fields.municipio.stringValue) {

                doc.text(`Ubicación del predio: ${fields.municipio.stringValue}`, {
                    width: 390,
                    align: 'left'
                })

            } else {
                doc.text(`Coordenadas del predio: latitud ${fields.latitud.numberValue}, longitud ${fields.longitud.numberValue}`, {
                    width: 390,
                    align: 'left'
                })
            }

            doc.moveDown(0.5)
                .text(`Tiempo habitando el predio: ${fields.tiempo_habita_predio.stringValue}`, {
                    width: 390,
                    align: 'left'
                }).moveDown(0.5).moveDown();

            doc.moveDown()
                .fontSize(6)
                .font('Helvetica')
                .text('Sus datos serán tratados conforme a la ley 1581 de 2012. La información ingresada podrá ser contrastada y verificada por el gobierno. La inscripción por este canal no constituye un derecho. La ANT se podrá comunicar a través de este medio para informar, notificar o solicitar información adicional relacionada con la solicitud radicada.', {
                    width: 340,
                    align: 'left'
                });

            // Finalize PDF file
            doc.end();

            await sleep(1000);

            uploadMedia(docUrl, from_id).then(function (result) {
                if (result.id) {
                    axios({
                        method: 'POST',
                        url:
                            'https://graph.facebook.com/v12.0/' +
                            from_id +
                            '/messages?access_token=' +
                            TOKEN,
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        data: {
                            messaging_product: "whatsapp",
                            to: to,
                            type: "document",
                            document: {
                                id: result.id,
                                caption: "Certificado de registro",
                                filename: docId + ".pdf"
                            }
                        }
                    });
                }
            });


            break;
        }
        case "compraTierrasResult": {

            // Create a document
            const doc = new PDFDocument({
                size: [419, 297],
                orientation: 'landscape',
                margins: {
                    top: 10,
                    bottom: 10,
                    left: 40,
                    rigth: 40
                }
            });


            // Saving the pdf file in root directory.
            doc.pipe(fs.createWriteStream(docUrl));

            // Adding an image in the pdf.
            doc.image('img/logo_agencia.png', {
                fit: [80, 80],
                x: 10,
                y: 10
            });

            doc.image('img/gobierno.png', {
                fit: [100, 100],
                x: 300,
                y: 270
            });

            doc.image('img/IWUFHC7PAPILD1.png', {
                fit: [40, 40],
                x: 360,
                y: 10
            });


            doc.moveDown()
                .fontSize(10)
                .font('Helvetica-Bold')
                .text('Inscripción al registro de inmuebles rurales (RIR): 00021150', {
                    width: 340,
                    align: 'center'
                });

            doc.fontSize(8)
                .font('Helvetica').moveDown().moveDown()
                .text('Se ha registrado la siguiente información:', {
                    width: 390,
                    align: 'left'
                }).moveDown().moveDown()
                .text(`Vendedor o interesado: ${fields.nombre.stringValue}`, {
                    width: 390,
                    align: 'left'
                }).moveDown(0.5)
                .text(`Tipo y número de documento: ${fields.tipo_documento.stringValue + " - " + fields.documento.stringValue}`, {
                    width: 390,
                    align: 'left'
                }).moveDown(0.5)
                .text(`Teléfono de contacto: ${fields.telefono.stringValue}`, {
                    width: 390,
                    align: 'left'
                }).moveDown(0.5)
                .text(`Matrícula inmobiliaria del predio: ${fields.matricula_inmobiliaria.stringValue}`, {
                    width: 390,
                    align: 'left'
                }).moveDown(0.5).moveDown();

            doc.moveDown()
                .fontSize(6)
                .font('Helvetica')
                .text('Sus datos serán tratados conforme a la ley 1581 de 2012. La información ingresada podrá ser contrastada y verificada por el gobierno. La inscripción por este canal no constituye un derecho. La ANT se podrá comunicar a través de este medio para informar, notificar o solicitar información adicional relacionada con la solicitud radicada.', {
                    width: 340,
                    align: 'left'
                });

            // Finalize PDF file
            doc.end();

            await sleep(1000);

            uploadMedia(docUrl, from_id).then(function (result) {
                if (result.id) {
                    axios({
                        method: 'POST',
                        url:
                            'https://graph.facebook.com/v12.0/' +
                            from_id +
                            '/messages?access_token=' +
                            TOKEN,
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        data: {
                            messaging_product: "whatsapp",
                            to: to,
                            type: "document",
                            document: {
                                id: result.id,
                                caption: "Certificado de registro",
                                filename: docId + ".pdf"
                            }
                        }
                    });
                }
            });


            break;
        }
        case "adjudicarResult": {

            // Create a document
            const doc = new PDFDocument({
                size: [419, 297],
                orientation: 'landscape',
                margins: {
                    top: 10,
                    bottom: 10,
                    left: 40,
                    rigth: 40
                }
            });


            // Saving the pdf file in root directory.
            doc.pipe(fs.createWriteStream(docUrl));

            // Adding an image in the pdf.
            doc.image('img/logo_agencia.png', {
                fit: [80, 80],
                x: 10,
                y: 10
            });

            doc.image('img/gobierno.png', {
                fit: [100, 100],
                x: 300,
                y: 270
            });

            doc.image('img/IWUFHC7PAPILD1.png', {
                fit: [40, 40],
                x: 360,
                y: 10
            });

            doc.moveDown()
                .fontSize(10)
                .font('Helvetica-Bold')
                .text('Número de formulario de caracterización: FC-000734', {
                    width: 340,
                    align: 'center'
                });

            doc.fontSize(8)
                .font('Helvetica').moveDown().moveDown()
                .text('Se ha registrado la siguiente información:', {
                    width: 390,
                    align: 'left'
                }).moveDown().moveDown()
                .text(`Aspirante o Solicitante: ${fields.nombre.stringValue}`, {
                    width: 390,
                    align: 'left'
                }).moveDown(0.5)
                .text(`Documento de identidad: ${fields.cedula.stringValue}`, {
                    width: 390,
                    align: 'left'
                }).moveDown(0.5)
                .text(`Teléfono de contacto: ${fields.telefono.stringValue}`, {
                    width: 390,
                    align: 'left'
                }).moveDown(0.5)
                .text(`Municipio donde espera el predio: ${fields.municipio.stringValue}`, {
                    width: 390,
                    align: 'left'
                }).moveDown(0.5).moveDown();

            doc.moveDown()
                .fontSize(6)
                .font('Helvetica')
                .text('Sus datos serán tratados conforme a la ley 1581 de 2012. La información ingresada podrá ser contrastada y verificada por el gobierno. La inscripción por este canal no constituye un derecho. La ANT se podrá comunicar a través de este medio para informar, notificar o solicitar información adicional relacionada con la solicitud radicada.', {
                    width: 340,
                    align: 'left'
                });

            // Finalize PDF file
            doc.end();

            await sleep(1000);

            uploadMedia(docUrl, from_id).then(function (result) {
                if (result.id) {
                    axios({
                        method: 'POST',
                        url:
                            'https://graph.facebook.com/v12.0/' +
                            from_id +
                            '/messages?access_token=' +
                            TOKEN,
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        data: {
                            messaging_product: "whatsapp",
                            to: to,
                            type: "document",
                            document: {
                                id: result.id,
                                caption: "Certificado de registro",
                                filename: docId + ".pdf"
                            }
                        }
                    });
                }
            });


            break;
        }
    }
}