const botname = require('../set');
const fetchSettings = require('../Database/fetchSettings');
const moment = require('moment'); 

const Events = async (client, Nick) => {
    try {
        const settings = await fetchSettings();
        let metadata = await client.groupMetadata(Nick.id);
        let participants = Nick.participants;
        let desc = metadata.desc || "No Description";
        let groupMembersCount = metadata.participants.length;
        const currentTime = moment().format('h:mm A'); 

        for (let num of participants) {
            let dpuser;

            try {
                dpuser = await client.profilePictureUrl(num, "image");
            } catch {
                dpuser = "https://files.catbox.moe/xmlidu.jpg";
            }

            if (Nick.action === "add") {
                if (settings.welcome === 'on') {
                    let userName = num;
                    const welcomeMessages = [
                        `🌟 *Welcome aboard, @${userName.split("@")[0]}!* 🌟\n\n🎉 You're the *${groupMembersCount}th* member of *${metadata.subject}*!\n⏰ Joined at: ${currentTime}\n\n_${botname} is here to make your stay awesome!_ 🚀`,
                        
                        `👋 *Hey @${userName.split("@")[0]}, welcome!* 👋\n\n🏆 Member #${groupMembersCount} just joined ${metadata.subject}!\n🕐 Time: ${currentTime}\n\n_${botname} says: Let's make some memories!_ ✨`,
                        
                        `🎯 *New member alert! @${userName.split("@")[0]}* 🎯\n\n📊 Total members: ${groupMembersCount}\n⏱ Joined: ${currentTime}\nGroup: ${metadata.subject}\n\n_${botname} welcomes you with virtual confetti!_ 🎊`,
                        
                        `🚀 *@${userName.split("@")[0]} has landed!* 🚀\n\n📈 We're now ${groupMembersCount} strong in ${metadata.subject}!\n⌚ Time of arrival: ${currentTime}\n\n_${botname} is ready to serve!_ 🤖💫`
                    ];
                    
                    
                    const randomIndex = Math.floor(Math.random() * welcomeMessages.length);
                    const Welcometext = welcomeMessages[randomIndex];
                    
                    await client.sendMessage(Nick.id, {
                        image: { url: dpuser },
                        caption: Welcometext,
                        mentions: [num],
                    });
                }
            } else if (Nick.action === "remove") {
                if (settings.goodbye === 'on') {
                    let userName2 = num;
                    const goodbyeMessages = [
                        `😢 *Farewell, @${userName2.split("@")[0]}!* 😢\n\n📉 We're now ${groupMembersCount} members in ${metadata.subject}\n⏰ Left at: ${currentTime}\n\n_${botname} will miss you! Safe travels!_ 👋`,
                        
                        `👋 *Goodbye @${userName2.split("@")[0]}!* 👋\n\n📊 Group size: ${groupMembersCount} members now\n🕐 Departure time: ${currentTime}\nGroup: ${metadata.subject}\n\n_${botname} waves goodbye!_ 🌊`,
                        
                        `🚪 *@${userName2.split("@")[0]} has left the building!* 🚪\n\n📈 Remaining members: ${groupMembersCount}\n⏱ Exit time: ${currentTime}\n\n_${botname} hopes our paths cross again!_ 💫`,
                        
                        `🎈 *Another one bites the dust!* 🎈\n\n@${userName2.split("@")[0]} left ${metadata.subject}\n📊 Current count: ${groupMembersCount}\n⌚ Time: ${currentTime}\n\n_${botname} says: On to new adventures!_ 🗺️`
                    ];
                    
                    
                    const randomIndex = Math.floor(Math.random() * goodbyeMessages.length);
                    const Lefttext = goodbyeMessages[randomIndex];
                    
                    await client.sendMessage(Nick.id, {
                        image: { url: dpuser },
                        caption: Lefttext,
                        mentions: [num],
                    });
                }
            }
        }
    } catch (err) {
        console.log("Events Error:", err);
    }
};

module.exports = Events;
