const {
  default: peaceConnect,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  jidDecode,
  proto,
  getContentType,
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require('path');
const axios = require("axios");
const express = require("express");
const chalk = require("chalk");
const FileType = require("file-type");
const figlet = require("figlet");
const logger = pino({ level: 'silent' });
const app = express();
const _ = require("lodash");
let lastTextTime = 0;
const messageDelay = 3000;
const currentTime = Date.now();
const Events = require('../peacemaker/events');
const authenticationn = require('../peacemaker/auth');
const { initializeDatabase, createTables } = require('../Database/config');
const fetchSettings = require('../Database/fetchSettings');
const PhoneNumber = require("awesome-phonenumber");
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('../lib/peaceexif');
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetchJson, await, sleep } = require('../lib/peacefunc');
const { sessionName, session, port, packname } = require("../set.js");
const makeInMemoryStore = require('../store/store.js'); 
const store = makeInMemoryStore({ logger: logger.child({ stream: 'store' }) });

// Rate-limited logging system to prevent buffer overflow
const LOG_INTERVAL = 15000; // 15 seconds between frequent logs
let lastLogTime = 0;
const createRateLimitedLogger = (interval = 5000) => {
  const lastLogged = new Map();
  return (key, message) => {
    const now = Date.now();
    const lastTime = lastLogged.get(key) || 0;
    
    if (now - lastTime > interval) {
      console.log(message);
      lastLogged.set(key, now);
      
      // Cleanup old entries periodically
      if (lastLogged.size > 100) {
        for (const [oldKey, oldTime] of lastLogged) {
          if (now - oldTime > 60000) { // 1 minute old
            lastLogged.delete(oldKey);
          }
        }
      }
    }
  };
};

const rateLimitedLog = createRateLimitedLogger(5000);

const color = (text, color) => {
  return !color ? chalk.green(text) : chalk.keyword(color)(text);
};

// Default settings as fallback
const defaultSettings = {
  autobio: 'off',
  autolike: 'off', 
  autoview: 'off',
  mode: 'public',
  prefix: '.',
  anticall: 'off',
  antiedit: 'off'
};

authenticationn();

async function initializeDatabaseWithRetry(maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      rateLimitedLog('db_init', `🔄 Database initialization attempt ${attempt}/${maxRetries}`);
      await initializeDatabase();
      await createTables();
      rateLimitedLog('db_success', "✅ PostgreSQL database initialized successfully");
      return true;
    } catch (error) {
      rateLimitedLog('db_error', `❌ Database init attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxRetries) {
        console.error("💥 All database initialization attempts failed");
        return false;
      }
      await sleep(2000); // Wait 2 seconds before retry
    }
  }
}

async function loadSettingsWithFallback() {
  try {
    const settings = await fetchSettings();
    rateLimitedLog('settings_load', "😴 Settings loaded from database");
    return settings;
  } catch (error) {
    rateLimitedLog('settings_fallback', `⚠️ Using default settings: ${error.message}`);
    return defaultSettings;
  }
}

async function startPeace() { 
  
  // Initialize database first
  const dbInitialized = await initializeDatabaseWithRetry();
  
  if (!dbInitialized) {
    rateLimitedLog('db_critical', "🚨 Continuing with default settings due to database failure");
  }

  let autobio, autolike, autoview, mode, prefix, anticall, antiedit;

  try {
    const settings = await loadSettingsWithFallback();
    
    ({ autobio, autolike, autoview, mode, prefix, anticall, antiedit } = settings);

    rateLimitedLog('settings_success', "✅ Settings loaded successfully");
    rateLimitedLog('settings_details', `Mode: ${mode}, Prefix: ${prefix}, Autobio: ${autobio}`);
  } catch (error) {
    console.error("💥 Critical: Failed to load settings:", error.message || error);
    // Use defaults as last resort
    ({ autobio, autolike, autoview, mode, prefix, anticall, antiedit } = defaultSettings);
    rateLimitedLog('settings_default', "🔄 Using default settings as fallback");
  }

  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version, isLatest } = await fetchLatestBaileysVersion();
  rateLimitedLog('wa_version', `using WA v${version.join(".")}, isLatest: ${isLatest}`);
  rateLimitedLog('banner', 
    color(
      figlet.textSync("PEACE-CORE", {
        font: "Standard",
        horizontalLayout: "default",
        vertivalLayout: "default",
        whitespaceBreak: false,
      }),
      "green"
    )
  );

  const client = peaceConnect({
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["PEACE-AI", "Safari", "5.1.7"],
    auth: state,
    syncFullHistory: true,
  });

  if (autobio === 'on') {
    setInterval(() => {
      const date = new Date();
      client.updateProfileStatus(
        `📅 𝙳𝙰𝚃𝙴/𝚃𝙸𝙼𝙴 ⌚️  ${date.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' })}  ⏰️ 𝙳𝙰𝚈 ⏰️  ${date.toLocaleString('en-US', { weekday: 'long', timeZone: 'Africa/Nairobi'})}. 𝙿𝙴𝙰𝙲𝙴 𝙷𝚄𝙱 𝚁𝙴𝙿𝚁𝙴𝚂𝙴𝙽𝚃𝚂 𝙲𝙾𝙽𝚂𝚃𝙰𝙽𝙲𝚈 𝙴𝚅𝙴𝙽 𝙸𝙽 𝙲𝙷𝙰𝙾𝚂⚡.`
      );
      
      // Reduced logging frequency for bio updates
      const now = Date.now();
      if (now - lastLogTime > LOG_INTERVAL) {
        rateLimitedLog('bio_update', '✅ Bio updated');
        lastLogTime = now;
      }
    }, 10 * 1000);
  }

 store.bind(client.ev);
  
  client.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      let mek = chatUpdate.messages[0];
      if (!mek.message) return;
      mek.message = Object.keys(mek.message)[0] === "ephemeralMessage" ? mek.message.ephemeralMessage.message : mek.message;

      
 if (autoview === 'on' && mek.key && mek.key.remoteJid === "status@broadcast") {
        client.readMessages([mek.key]);
      }
            
 if (autoview === 'on' && autolike === 'on' && mek.key && mek.key.remoteJid === "status@broadcast") {
        const nickk = await client.decodeJid(client.user.id);
        const emojis = ['💙','💚','💜'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        await client.sendMessage(mek.key.remoteJid, { react: { text: randomEmoji, key: mek.key, } }, { statusJidList: [mek.key.participant, nickk] });
        await sleep(messageDelay);
   rateLimitedLog('reaction_sent', 'Reaction sent successfully✅️');
          }

      
if (!client.public && !mek.key.fromMe && chatUpdate.type === "notify") return;
      let m = smsg(client, mek, store);
      const peace = require("../peacemaker/peace");
      peace(client, m, chatUpdate, store);
    } catch (err) {
      rateLimitedLog('message_error', `Message processing error: ${err.message}`);
    }
  });

// Add at top with other declarations
const processedEdits = new Set();
const EDIT_COOLDOWN = 5000; // 5 seconds cooldown
const EDIT_RETENTION = 60000; // 1 minute retention
const MAX_EDIT_ENTRIES = 1000;

// Regular cleanup for processedEdits
setInterval(() => {
  const now = Date.now();
  let deletedCount = 0;
  
  for (const [id, data] of processedEdits) {
    if (now - data[0] > EDIT_RETENTION || processedEdits.size > MAX_EDIT_ENTRIES) {
      processedEdits.delete(id);
      deletedCount++;
    }
  }
  
  if (deletedCount > 0) {
    rateLimitedLog('edit_cleanup', `🧹 Cleaned up ${deletedCount} old edit entries`);
  }
}, 30000); // Run every 30 seconds

client.ev.on('messages.update', async (messageUpdates) => {
  try {
    const { antiedit: currentAntiedit } = await loadSettingsWithFallback();
    if (currentAntiedit === 'off') return;

    const now = Date.now();
    
    for (const update of messageUpdates) {
      const { key, update: { message } } = update;
      if (!key?.id || !message) continue;

      const editId = `${key.id}-${key.remoteJid}`;
      
      // Skip if recently processed
      if (processedEdits.has(editId)) {
        const [timestamp] = processedEdits.get(editId);
        if (now - timestamp < EDIT_COOLDOWN) continue;
      }

      const chat = key.remoteJid;
      const isGroup = chat.endsWith('@g.us');
      const editedMsg = message.editedMessage?.message || message.editedMessage;
      if (!editedMsg) continue;

      // Get both messages properly
      const originalMsg = await store.loadMessage(chat, key.id) || {};
      const sender = key.participant || key.remoteJid;
      const senderName = await client.getName(sender);

      // Enhanced content extractor
      const getContent = (msg) => {
        if (!msg) return '[Deleted]';
        const type = Object.keys(msg)[0];
        const content = msg[type];
        
        switch(type) {
          case 'conversation': 
            return content;
          case 'extendedTextMessage': 
            return content.text + 
                  (content.contextInfo?.quotedMessage ? ' (with quoted message)' : '');
          case 'imageMessage': 
            return `🖼️ ${content.caption || 'Image'}`;
          case 'videoMessage': 
            return `🎥 ${content.caption || 'Video'}`;
          case 'documentMessage': 
            return `📄 ${content.fileName || 'Document'}`;
          default: 
            return `[${type.replace('Message', '')}]`;
        }
      };

      const originalContent = getContent(originalMsg.message);
      const editedContent = getContent(editedMsg);

      // Only proceed if content actually changed
      if (originalContent === editedContent) {
        rateLimitedLog('edit_no_change', `[ANTIEDIT] No content change detected for ${editId}`);
        continue;
      }

      const notificationMessage = `*⚠️📌 ᴘᴇᴀᴄᴇ ᴄᴏʀᴇ ᴀɴᴛɪᴇᴅɪᴛ 📌⚠️*\n\n` +
                               `👤 *sᴇɴᴅᴇʀ:* @${sender.split('@')[0]}\n` +
                               `📄 *ᴏʀɪɢɪɴᴀʟ ᴍᴇssᴀɢᴇ:* ${originalContent}\n` +
                               `✏️ *ᴇᴅɪᴛᴇᴅ ᴍᴇssᴀɢᴇ:* ${editedContent}\n` +
                               `🧾 *ᴄʜᴀᴛ ᴛʏᴘᴇ:* ${isGroup ? 'Group' : 'DM'}`;

      const sendTo = currentAntiedit === 'private' ? client.user.id : chat;
      await client.sendMessage(sendTo, { 
        text: notificationMessage,
        mentions: [sender]
      });

      // Update tracking with timestamp
      processedEdits.set(editId, [now, originalContent, editedContent]);
      rateLimitedLog(`edit_${sender}`, `[ANTIEDIT] Reported edit from ${senderName}`);
    }

    // Cleanup old entries
    for (const [id, data] of processedEdits) {
      if (now - data[0] > EDIT_RETENTION) {
        processedEdits.delete(id);
      }
    }
  } catch (err) {
    rateLimitedLog('antiedit_error', `[ANTIEDIT ERROR] ${err.message}`);
  }
});

  // Handle error
  const unhandledRejections = new Map();
  process.on("unhandledRejection", (reason, promise) => {
    // Filter out common non-critical errors
    if (reason.message && reason.message.includes("Connection Closed")) {
      rateLimitedLog('connection_closed', "🔌 Connection closed (non-critical)");
      return;
    }
    
    unhandledRejections.set(promise, reason);
    rateLimitedLog('unhandled_rejection', `Unhandled Rejection: ${reason.message}`);
  });
  
  process.on("rejectionHandled", (promise) => {
    unhandledRejections.delete(promise);
  });
  
  process.on("uncaughtException", function (err) {
    rateLimitedLog('uncaught_exception', `Uncaught Exception: ${err.message}`);
  });

  // Setting
  client.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      let decode = jidDecode(jid) || {};
      return (decode.user && decode.server && decode.user + "@" + decode.server) || jid;
    } else return jid;
  };
   
  client.ev.on("contacts.update", (update) => {
    for (let contact of update) {
      let id = client.decodeJid(contact.id);
      if (store && store.contacts) store.contacts[id] = { id, name: contact.notify };
    }
  });
  
client.ev.on("group-participants.update", async (m) => {
    Events(client, m);
  });
  
 client.ev.on('call', async (callData) => {
  const { anticall: dbAnticall } = await loadSettingsWithFallback();

  if (dbAnticall === 'on') {
    const callId = callData[0]?.id;
    const callerId = callData[0]?.from;

    if (callId && callerId) {
      await client.rejectCall(callId, callerId);
      const currentTime = Date.now();
      if (currentTime - lastTextTime >= messageDelay) {
        await client.sendMessage(callerId, {
          text: "🚫 Anticall is active. Only text messages are allowed."
        });
        lastTextTime = currentTime;
      }
    }
  } else {
    rateLimitedLog('anticall_off', "✅ Anticall is OFF. Call ignored.");
  }
});

        
  client.getName = (jid, withoutContact = false) => {
    let id = client.decodeJid(jid);
    withoutContact = client.withoutContact || withoutContact;
    let v;
    if (id.endsWith("@g.us"))
      return new Promise(async (resolve) => {
        v = store.contacts[id] || {};
        if (!(v.name || v.subject)) v = client.groupMetadata(id) || {};
        resolve(v.name || v.subject || PhoneNumber("+" + id.replace("@s.whatsapp.net", "")).getNumber("international"));
      });
    else
      v =
        id === "0@s.whatsapp.net"
          ? {
              id,
              name: "WhatsApp",
            }
          : id === client.decodeJid(client.user.id)
          ? client.user
          : store.contacts[id] || {};
    return (withoutContact ? "" : v.name) || v.subject || v.verifiedName || PhoneNumber("+" + jid.replace("@s.whatsapp.net", "")).getNumber("international");
  };

  client.setStatus = (status) => {
    client.query({
      tag: "iq",
      attrs: {
        to: "@s.whatsapp.net",
        type: "set",
        xmlns: "status",
      },
      content: [
        {
          tag: "status",
          attrs: {},
          content: Buffer.from(status, "utf-8"),
        },
      ],
    });
    return status;
  };

  client.public = true;

  client.serializeM = (m) => smsg(client, m, store);
  client.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
      
      // Handle specific disconnect reasons
      if (reason === DisconnectReason.badSession) {
        console.log(`Bad Session File, Please Delete Session and Scan Again`);
        process.exit();
      } else if (reason === DisconnectReason.connectionClosed) {
        rateLimitedLog('reconnection', "Connection closed, reconnecting....");
        startPeace();
      } else if (reason === DisconnectReason.connectionLost) {
        rateLimitedLog('reconnection', "Connection Lost from Server, reconnecting...");
        startPeace();
      } else if (reason === DisconnectReason.connectionReplaced) {
        console.log("Connection Replaced, Another New Session Opened, Please Restart Bot");
        process.exit();
      } else if (reason === DisconnectReason.loggedOut) {
        console.log(`Device Logged Out, Please Delete Session_id and Scan Again.`);
        process.exit();
      } else if (reason === DisconnectReason.restartRequired) {
        rateLimitedLog('reconnection', "Restart Required, Restarting...");
        startPeace();
      } else if (reason === DisconnectReason.timedOut) {
        rateLimitedLog('reconnection', "Connection TimedOut, Reconnecting...");
        startPeace();
      } else if (reason === 405) {
        rateLimitedLog('reconnection', "Connection error 405, reconnecting...");
        startPeace();
      } else {
        rateLimitedLog('unknown_reason', `Unknown DisconnectReason: ${reason}|${connection} - Reconnecting`);
        startPeace();
      }
    } else if (connection === "open") {
      rateLimitedLog('connection_open', "🔗 Connection established successfully");

      const Texxt = `🔶 *ᴘᴇᴀᴄᴇ ᴄᴏʀᴇ ꜱᴛᴀᴛᴜꜱ*\n` +
              `───────────────────────\n` +
              `⚙️  ᴍᴏᴅᴇ » ${mode}\n` +
              `⌨️  ᴘʀᴇꜰɪx » ${prefix}\n` +
              `⏰  ᴛɪᴍᴇ » ${new Date().toLocaleTimeString('en-US', { 
                timeZone: 'Africa/Nairobi',
                hour: '2-digit', 
                minute: '2-digit', 
                hour12: false 
              })}\n` +
              `📅  ᴅᴀʏ » ${new Date().toLocaleDateString('en-US', { 
                timeZone: 'Africa/Nairobi',
                weekday: 'long' 
              })}\n` +
              `───────────────────────\n` +
              `✅ ᴄᴏɴɴᴇᴄᴛᴇᴅ & ᴀᴄᴛɪᴠᴇ`;
              
      try {
        await client.sendMessage(client.user.id, { text: Texxt });
        rateLimitedLog('status_sent', "📤 Status message sent successfully");
      } catch (error) {
        rateLimitedLog('status_error', `Failed to send status: ${error.message}`);
      }

      console.log(color("Congrats, PEACE-HUB has successfully connected to this server", "green"));
      console.log(color("Follow me on Instagram as peacemaker_hunter72", "red"));
      console.log(color("Text the bot number with menu to check my command list"));
}
});

  client.ev.on("creds.update", saveCreds);
 const getBuffer = async (url, options) => {
    try {
      options ? options : {};
      const res = await axios({
        method: "get",
        url,
        headers: {
          DNT: 1,
          "Upgrade-Insecure-Request": 1,
        },
        ...options,
        responseType: "arraybuffer",
      });
      return res.data;
    } catch (err) {
      return err;
    }
  };

  client.sendImage = async (jid, path, caption = "", quoted = "", options) => {
    let buffer = Buffer.isBuffer(path)
      ? path
      : /^data:.*?\/.*?;base64,/i.test(path)
      ? Buffer.from(path.split`,`[1], "base64")
      : /^https?:\/\//.test(path)
      ? await getBuffer(path)
      : fs.existsSync(path)
      ? fs.readFileSync(path)
      : Buffer.alloc(0);
    return await client.sendMessage(jid, { image: buffer, caption: caption, ...options }, { quoted });
  };

  client.sendFile = async (jid, PATH, fileName, quoted = {}, options = {}) => {
    let types = await client.getFile(PATH, true);
    let { filename, size, ext, mime, data } = types;
    let type = '', mimetype = mime, pathFile = filename;
    if (options.asDocument) type = 'document';
    if (options.asSticker || /webp/.test(mime)) {
      let { writeExif } = require('../lib/peaceexif.js');
      let media = { mimetype: mime, data };
      pathFile = await writeExif(media, { packname: packname, author: packname, categories: options.categories ? options.categories : [] });
      await fs.promises.unlink(filename);
      type = 'sticker';
      mimetype = 'image/webp';
    } else if (/image/.test(mime)) type = 'image';
    else if (/video/.test(mime)) type = 'video';
    else if (/audio/.test(mime)) type = 'audio';
    else type = 'document';
    await client.sendMessage(jid, { [type]: { url: pathFile }, mimetype, fileName, ...options }, { quoted, ...options });
    return fs.promises.unlink(pathFile);
  };

  client.parseMention = async (text) => {
    return [...text.matchAll(/@([0-9]{5,16}|0)/g)].map(v => v[1] + '@s.whatsapp.net');
  };

  client.sendImageAsSticker = async (jid, path, quoted, options = {}) => {
    let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await getBuffer(path) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0);
    let buffer;
    if (options && (options.packname || options.author)) {
      buffer = await writeExifImg(buff, options);
    } else {
      buffer = await imageToWebp(buff);
    }
    await client.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted });
    return buffer;
  };

  client.sendVideoAsSticker = async (jid, path, quoted, options = {}) => {
    let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await getBuffer(path) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0);
    let buffer;
    if (options && (options.packname || options.author)) {
      buffer = await writeExifVid(buff, options);
    } else {
      buffer = await videoToWebp(buff);
    }
    await client.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted });
    return buffer;
  };

  client.downloadMediaMessage = async (message) => {
    let mime = (message.msg || message).mimetype || '';
    let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
    const stream = await downloadContentFromMessage(message, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
  };

  client.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
    let quoted = message.msg ? message.msg : message;
    let mime = (message.msg || message).mimetype || '';
    let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
    const stream = await downloadContentFromMessage(quoted, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    let type = await FileType.fromBuffer(buffer);
    trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
    await fs.writeFileSync(trueFileName, buffer);
    return trueFileName;
  };

  client.sendText = (jid, text, quoted = "", options) => client.sendMessage(jid, { text: text, ...options }, { quoted });

  client.cMod = (jid, copy, text = "", sender = client.user.id, options = {}) => {
    let mtype = Object.keys(copy.message)[0];
    let isEphemeral = mtype === "ephemeralMessage";
    if (isEphemeral) {
      mtype = Object.keys(copy.message.ephemeralMessage.message)[0];
    }
    let msg = isEphemeral ? copy.message.ephemeralMessage.message : copy.message;
    let content = msg[mtype];
    if (typeof content === "string") msg[mtype] = text || content;
    else if (content.caption) content.caption = text || content.caption;
    else if (content.text) content.text = text || content.text;
    if (typeof content !== "string")
      msg[mtype] = {
        ...content,
        ...options,
      };
    if (copy.key.participant) sender = copy.key.participant = sender || copy.key.participant;
    else if (copy.key.participant) sender = copy.key.participant = sender || copy.key.participant;
    if (copy.key.remoteJid.includes("@s.whatsapp.net")) sender = sender || copy.key.remoteJid;
    else if (copy.key.remoteJid.includes("@broadcast")) sender = sender || copy.key.remoteJid;
    copy.key.remoteJid = jid;
    copy.key.fromMe = sender === client.user.id;

    return proto.WebMessageInfo.fromObject(copy);
  };

  return client;
}

app.use(express.static("pixel"));
app.get("/", (req, res) => res.sendFile(__dirname + "/index.html"));
app.listen(port, () => console.log(`📡 Connected on port http://localhost:${port} 🛰`));

startPeace();

let file = require.resolve(__filename);
fs.watchFile(file, () => {
  fs.unwatchFile(file);
  console.log(chalk.redBright(`Update ${__filename}`));
  delete require.cache[file];
  require(file);
});
