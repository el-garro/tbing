const bingChat = require("./bingAI.js");
const readline = require("readline");

const chat = new bingChat();


async function interactiveChat() {
    const prompt = "Prompt: "
    let query = "";
    let morelines = false;
    let interface = readline.createInterface({
        input: process.stdin,
        output: process.stderr,
        prompt: prompt
    });
    process.stderr.write("BingAI CLI - By Nyan (https://t.me/el_garro)\n");
    process.stderr.write("\n");
    process.stderr.write("Salir: CTRL+C\n");
    process.stderr.write("Alternar modo multilínea: ...\n");
    process.stderr.write("\n");
    interface.prompt()


    interface.on('line', async (line) => {

        if (line === "...") {
            morelines = !morelines
            interface.setPrompt("")
        } else {
            query += line + "\n";
        }

        if (!morelines) {
            if (query.trim()) await processQuery(query)
            query = "";
            interface.setPrompt(prompt)
            process.stderr.write("\n")
            interface.prompt()
        }

    });
}

async function processQuery(query) {
    if (!chat.conversationSignature) {
        process.stderr.write("Inicializando chat...")
        try {
            await chat.newConversation();
        } catch (e) {
            process.stderr.write(`\r\x1b[KError inicializando chat: ${e.message}\n`)
            return false
        }
    }

    try {
        let result = await chat.ask(query, "Creative", undefined, progressCallback)
        process.stderr.write("\r\x1b[K")
        console.log(result)
        return true
    } catch (e) {
        process.stderr.write(`\r\x1b[KError: ${e.message}\n`)
        return false
    }
}

function progressCallback(text) {
    const words = text.split(/\s/).filter((item) => item).length
    const chars = text.length
    process.stderr.write(`\r\x1b[KGenerando: ${words} palabras, ${chars} caracteres...`)
}


async function main() {
    if (process.argv.length <= 2) {
        if (process.stdin.isTTY) {
            // Interactive bingChat
            interactiveChat()
        } else {
            // Get data from pipe
            let query = ""
            for await (const chunk of process.stdin) query += chunk;
            if (!(await processQuery(query))) process.exit(1)

        }
    } else {
        // Get query from commandline
        let query = process.argv.slice(2).join(" ")
        if (!(await processQuery(query))) process.exit(1)
    }
}

main()