const makeWASocket = require("@whiskeysockets/baileys").default;
const {
    useMultiFileAuthState,
    PHONENUMBER_MCC,
    jidDecode,
    makeInMemoryStore,
    DisconnectReason
} = require("@whiskeysockets/baileys");
const logger = require("@whiskeysockets/baileys/lib/Utils/logger").default;
const readline = require("readline");
const pino = require("pino");
const chalk = import("chalk"); // Berbeda dari yang lain :v
const spinnies = new(require("spinnies"))();

global.store = makeInMemoryStore({
    logger: pino().child({
        level: "silent",
        stream: "store"
    })
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
})
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const color = (text, color) => {
    return !color ? chalk.green(text) : chalk.keyword(color)(text);
};

async function main() {
    const {
        state,
        saveCreds
    } = await useMultiFileAuthState("state");

    const sock = makeWASocket({
        logger: pino({
            level: "silent"
        }),
        printQRInTerminal: !global.system.usePairingCode,
        browser: [global.info.name, "Safari", "1.0.0"],
        auth: state,
        markOnlineOnConnect: global.system.alwaysOnline
    });

    if (global.system.usePairingCode && !sock.authState.creds.registered) {
        let phoneNumber;
        phoneNumber = await question("Enter phone number: ");
        phoneNumber = phoneNumber.replace(/[^0-9]/g, "");

        if (!Object.keys(PHONENUMBER_MCC).some((v) => phoneNumber.startsWith(v))) {
            console.log("Enter the phone number according to your country code.");
            phoneNumber = await question("Enter phone number: ");
            phoneNumber = phoneNumber.replace(/[^0-9]/g, "");
            rl.close();
        }

        setTimeout(async () => {
            let code = await sock.requestPairingCode(phoneNumber);
            code = code.match(/.{1,4}/g).join("-") || code;
            console.log("Your pairing code: \n" + code);
        }, 3000);
    }

    sock.ev.on("messages.upsert", async (chatUpdate) => {
        const m = chatUpdate.messages[0];
        processMessage(m, sock);
    });

    sock.decodeJid = (jid) => {
        if (!jid) return jid;
        return /:\d+@/gi.test(jid) ? (jidDecode(jid) || {}).user + "@" + (jidDecode(jid) || {}).server : jid;
    };

    sock.ev.on("connection.update", (update) => handleConnectionUpdate(update, sock));
    sock.ev.on("creds.update", saveCreds);
}

function processMessage(m, sock) {
    m.chat = m.key.remoteJid;
    m.fromMe = m.key.fromMe;
    m.sender = sock.decodeJid((m.fromMe && sock.user.id) || m.participant || m.key.participant || m.chat);

    if (!m.message) return;

    if (global.system.autoTyping) {
        if (m.chat.endsWith("@s.whatsapp.net")) {
            sock.sendPresenceUpdate("composing", m.chat);
        }
    }

    if (global.system.autoRecording) {
        if (m.chat.endsWith("@s.whatsapp.net")) {
            sock.sendPresenceUpdate("recording", m.chat);
        }
    }

    if (global.system.autoViewStatus) {
        if (m.chat.endsWith("broadcast")) {
            sock.readMessages([m.key]);
        }
    }

    setInterval(async () => {
        if (global.system.autoUpdateBio) {
            await sock.updateProfileStatus(global.info.status);
        }
    }, 60000);
}

function handleConnectionUpdate(update, sock) {
    const {
        connection,
        lastDisconnect,
        qr
    } = update;
    if (lastDisconnect == "undefined" && qr != "undefined") {
        qrcode.generate(qr, {
            small: true
        });
    }
    if (connection === "connecting") {
        spinnies.add("start", {
            text: "Connecting..."
        });
    } else if (connection === "open") {
        spinnies.succeed("start", {
            text: `Connected successfully. You have logged in as ${sock.user.name}`
        });
    } else if (connection === "close") {
        if (lastDisconnect.error.output.statusCode == DisconnectReason.loggedOut) {
            spinnies.fail("start", {
                text: `Can't connect!`
            });
            process.exit(0);
        } else {
            main().catch(() => main());
        }
    }
}

main();