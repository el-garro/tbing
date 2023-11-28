const crypto = require("crypto");
const WebSocket = require("faye-websocket");

class bingRequest {
    constructor(type, invocationId, target, args) {
        this.arguments = args;
        this.invocationId = invocationId?.toString(); // Microsoft is weird
        this.target = target;
        this.type = type;
    }
}

class bingMessage {
    constructor(locale, author, inputMethod, text, messageType, requestId, messageId) {
        this.locale = locale;
        this.author = author;
        this.inputMethod = inputMethod;
        this.text = text;
        this.messageType = messageType;
        this.requestId = requestId;
        this.messageId = messageId;
    }
}

class bingParticipant {
    constructor(id) {
        this.id = id;
    }
}

class bingMessageQuery {
    constructor(conversationId, conversationSignature, participant, traceId, isStartOfSession, message, tone, source, optionsSets, allowedMessageTypes, sliceIds, verbosity, requestId, spokenTextMode) {
        this.source = source;
        this.optionsSets = optionsSets;
        this.allowedMessageTypes = allowedMessageTypes;
        this.sliceIds = sliceIds;
        this.verbosity = verbosity;
        this.traceId = traceId;
        this.isStartOfSession = isStartOfSession;
        this.message = message;
        this.tone = tone;
        this.requestId = requestId;
        this.conversationSignature = conversationSignature;
        this.participant = participant;
        this.spokenTextMode = spokenTextMode;
        this.conversationId = conversationId;
    }
}

class bingChat {
    constructor(clientId, conversationId, conversationSignature, encryptedConversationSignature, traceId) {
        this.messageHistory = [];
        this.clientId = clientId;
        this.conversationId = conversationId;
        this.conversationSignature = conversationSignature;
        this.encryptedConversationSignature = encryptedConversationSignature
        this.traceId = traceId;

    }

    async newConversation() {
        const customHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/113.0.1774.57" };
        const url = "https://www.bing.com/turing/conversation/create?bundleVersion=1.1055.8-FTRDebug.2";
        const tries = 3

        for (let i = 1; i <= tries; i++) {
            try {
                const response = await fetch(url, { headers: customHeaders });
                const jsonResponse = await response.json();


                if (jsonResponse?.result?.value != "Success") {
                    throw new Error(jsonResponse?.result?.message);
                }

                if (!jsonResponse?.clientId) {
                    throw new Error("No se pudo obtener clientID");
                }

                if (!jsonResponse?.conversationId) {
                    throw new Error("No se pudo obtener conversationId");
                }

                // if (!jsonResponse?.conversationSignature) {
                //     throw new Error("No se pudo obtener conversationSignature");
                // }

                this.messageHistory = [];
                this.clientId = jsonResponse.clientId;
                this.conversationId = jsonResponse.conversationId;
                this.conversationSignature = jsonResponse.conversationSignature;
                this.encryptedConversationSignature = response.headers.get("x-sydney-encryptedconversationsignature")
                this.traceId = crypto.randomBytes(16).toString("hex");
                break;
            } catch (e) {
                if (i === tries) throw e
            }

        }

    }

    async ask(text, tone, locale, progressCallback) {
        if (progressCallback) progressCallback("");
        const invocationId = this.messageHistory.length
        const messageRequest = this.#createMessageRequest(this.conversationId, this.conversationSignature, this.clientId, this.traceId, invocationId, tone, text, locale)
        let wsUrl = "wss://sydney.bing.com/sydney/ChatHub"
        wsUrl = this.encryptedConversationSignature ? wsUrl + `?sec_access_token=${encodeURIComponent(this.encryptedConversationSignature)}` : wsUrl;
        let ws = new WebSocket.Client(wsUrl);
        let err = null

        ws.on('open', () => {
            ws.send(JSON.stringify({ "protocol": "json", "version": 1 }) + "\x1e")
            ws.send(JSON.stringify(messageRequest) + "\x1e")
        });

        ws.on('close', () => {
            ws = null;
        });

        ws.on('message', (event) => {
            const packets = event.data
                .split("\x1e")
                .map((str) => { try { return JSON.parse(str); } catch { } })
                .filter((item) => item);

            for (const packet of packets) {
                // console.log("\n" + JSON.stringify(packet) + "\n")

                if (packet?.error) {
                    err = packet?.error;
                    ws.close();
                    return;
                }

                if (packet?.type === 6) { // Ping
                    ws.send(JSON.stringify(new bingRequest(6))); // Pong
                    continue;
                }

                if (packet?.type === 1 && progressCallback) {
                    const botProgressMessage = packet?.arguments?.[0].messages?.[0];

                    const botProgressText = this.#getMessageText(botProgressMessage)

                    if (botProgressText) progressCallback(botProgressText);
                }

                if (packet?.type === 2) { // Completed
                    // console.log(JSON.stringify(packet, undefined, 4))

                    if (packet?.item?.result?.error) {
                        err = packet?.item?.result?.message;
                        ws.close();
                        return;
                    }

                    const messages = packet?.item?.messages
                    const disengagedMessage = messages.filter?.((message) => message?.messageType === "Disengaged")?.[0]
                    const botResponseMessage = messages.filter?.((message) => message?.author === "bot" && !message?.messageType)?.[0]

                    if (botResponseMessage?.contentOrigin === "TurnLimiter" || disengagedMessage) {
                        err = "El servidor ha finalizado la conversación. El próximo mensaje creará una nueva."
                        this.clientId = undefined
                        this.conversationId = undefined
                        this.conversationSignature = undefined
                        this.encryptedConversationSignature = undefined
                        this.messageHistory = []
                        ws.close();
                        return;
                    }

                    const botResponseText = this.#getMessageText(botResponseMessage)

                    if (!botResponseText) {
                        err = `No se pudo encontrar un mensaje apropiado. Último paquete:\n${JSON.stringify(packet)}`;
                        ws.close();
                        return;
                    }

                    this.messageHistory.push({ userMessage: text, botResponse: botResponseText })
                    ws.close();
                }

            }
        });


        while (ws) {
            await (new Promise(resolve => setTimeout(resolve, 500)));
            if (err) { throw new Error(err) }
        }

        try {
            return this.messageHistory[invocationId].botResponse;
        }
        catch {
            throw new Error("Se ha terminado la conexión sin generar respuesta.")
        }
    }

    #createMessageRequest(conversationId, conversationSignature, clientId, traceId, invocationId, tone, text, locale) {
        const author = "user";
        const inputMethod = "Keyboard";
        const messageType = "Chat";
        const requestId = crypto.randomUUID();
        const messageId = requestId;
        const isStartOfSession = invocationId ? false : true;
        const source = "cib";
        const verbosity = "verbose";
        const spokenTextMode = "None";

        const optionsSets = {
            Creative: ["nlu_direct_response_filter", "deepleo", "disable_emoji_spoken_text",
                "responsible_ai_policy_235", "enablemm", "dv3sugg", "iyxapbing", "iycapbing", "h3imaginative",
                "clgalileo", "gencontentv3", "uquopt", "log2sph", "savemem", "savememfilter", "uprofgen",
                "uprofupd", "iyjbexp", "izfstprmpt", "eredirecturl"],

            Balanced: ["nlu_direct_response_filter", "deepleo", "disable_emoji_spoken_text",
                "responsible_ai_policy_235", "enablemm", "dv3sugg", "iyxapbing", "iycapbing",
                "galileo", "uquopt", "log2sph", "savemem", "savememfilter", "uprofgen",
                "uprofupd", "iyjbexp", "izfstprmpt", "eredirecturl", "saharagenconv5"],

            Precise: ["nlu_direct_response_filter", "deepleo", "disable_emoji_spoken_text",
                "responsible_ai_policy_235", "enablemm", "dv3sugg", "iyxapbing", "iycapbing", "h3precise",
                "clgalileo", "gencontentv3", "uquopt", "log2sph", "savemem", "savememfilter", "uprofgen",
                "uprofupd", "iyjbexp", "izfstprmpt", "eredirecturl"]
        };


        const allowedMessageTypes = ["ActionRequest", "Chat", "Context", "InternalSearchQuery",
            "Disengaged", "InternalLoaderMessage", "Progress", "RenderCardRequest",
            "AdsQuery", "SemanticSerp", "GenerateContentQuery", "SearchQuery"];

        const sliceIds = ["emovoice", "0712newas2", "inochatsa", "wrapnoins", "splitctrl", "remsaconnchr",
            "sydconfigoptc", "806log2sph", "178gentechs0", "911memdark", "0822localvgs0", "0901fstprmpt",
            "298thelpgnds0", "727nrprdrt3"];

        const participant = new bingParticipant(clientId);

        const message = new bingMessage(locale, author, inputMethod, text, messageType, requestId, messageId);

        const messageQuery = new bingMessageQuery(conversationId, conversationSignature, participant,
            traceId, isStartOfSession, message, tone, source, optionsSets[tone], allowedMessageTypes,
            sliceIds, verbosity, requestId, spokenTextMode);

        const request = new bingRequest(4, invocationId, "chat", [messageQuery]);

        return request;
    }

    #getMessageText(message) {
        return message?.adaptiveCards?.[0]?.body?.[0]?.text // Fancy text
            || message?.text // Text
            || message?.hiddenText; // Fallback text
        // return message?.adaptiveCards?.[0]?.body?.reduce((acc, curr) => `${acc}${curr.text ? curr.text + "\n\n" : ""}`, "") // Fancy text
        //     || message?.text // Text
        //     || message?.hiddenText; // Fallback text
    }
}

module.exports = bingChat