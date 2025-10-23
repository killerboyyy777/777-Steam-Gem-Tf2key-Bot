// -------------------------------------------------------------
// Modified Version of Steam-Gem-Key-Bot
// Original Author: mfw (https://steamcommunity.com/id/mfwBan)
// Original License: GNU General Public License v3.0 (GPLv3)
// 
// Modifications and maintenance by killerboyyy777 (https://steamcommunity.com/id/klb777)
// Changes include:
//    - Enhanced API communication
//    - Implemented AutoGem weekly conversion feature (previously only a config value)
//    - Updated profit tracking system
//    - Compatibility fixes and improved logging
// © 2025 killerboy777 – Licensed under the same GPLv3
// -------------------------------------------------------------

// Global Requires (Node.js/Steam Modules)
const cluster = require('cluster');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const TradeOfferManager = require('steam-tradeoffer-manager');
const SteamCommunity = require('steamcommunity');
const sleep = require('system-sleep');
const fs = require('fs');
const CONFIG = require('./SETTINGS/config.js');

// Cluster setup for process resilience
if (cluster.isMaster) {
  cluster.fork();

  cluster.on('exit', function() {
    cluster.fork();
  });
}

if (cluster.isWorker) {
  // Global definitions for the worker
  const SID64REGEX = /^[0-9]{17}$/; 
  let userMsgs = {}; // Used for spam filtering
  
  // Initialize Steam Objects
  const client = new SteamUser();
  const manager = new TradeOfferManager({
    language: 'en',
    steam: client,
    pollInterval: '15000',
    cancelTime: '25000',
  });
  const community = new SteamCommunity();

  // Custom logging function
  function log(...args) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }

  function logError(...args) {
    // eslint-disable-next-line no-console
    console.error(...args);
  }

  // Get current time for log timestamps
  function getTime() {
    const time = new Date();
    const hours = String(time.getHours()).padStart(2, '0');
    const minutes = String(time.getMinutes()).padStart(2, '0');
    const seconds = String(time.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  // Initialize Profit JSON if it doesn't exist
  function InitJSON() {
    if (fs.existsSync('./SETTINGS/TotalSold.json')) {
      return; // File already exists
    }
    
    log(`[${getTime()}] [Init] TotalSold.json not found. Creating a new one...`);
    
    const defaultStructure = {
      Profit: {
        Buy: {
          TF2: [0, 0, 0], // [Lifetime, Weekly, Daily] - Profit from !BuyTF
          CRAP: [0, 0, 0] // [Lifetime, Weekly, Daily] - Profit from buying BGs/Emotes
        },
        Sell: {
          TF2: [0, 0, 0], // [Lifetime, Weekly, Daily] - Profit from !SellTF
          CRAP: [0, 0, 0] // [Lifetime, Weekly, Daily] - Profit from selling BGs/Emotes
        }
      }
    };
    
    try {
      // Ensure directory exists
      if (!fs.existsSync('./SETTINGS')) {
        fs.mkdirSync('./SETTINGS');
      }
      fs.writeFileSync(
        './SETTINGS/TotalSold.json',
        JSON.stringify(defaultStructure, undefined, '\t'),
      );
    } catch (err) {
      logError(`[${getTime()}] [Init] FATAL ERROR: Could not create TotalSold.json: ${err.message}`);
      process.exit(1); // Exit worker if we can't write the profit file
    }
  }
  
  // Converts unwanted items to gems (Gemini Version)
  async function autoGemItems() {
    try {
      log(`[${getTime()}] [AutoGem] Checking inventory for items to convert...`);

      const sessionID = community.getSessionID();
      if (!sessionID) {
        log(`[${getTime()}] [AutoGem] No valid session ID yet, skipping.`);
        return;
      }

      // Fetch user inventory (App ID 753, Context ID 6 for Steam Community)
      const inventory = await new Promise((resolve, reject) => {
        community.getUserInventoryContents(client.steamID, 753, 6, true, (err, inv) => {
          if (err) return reject(err);
          resolve(inv || []);
        });
      });

      if (inventory.length === 0) {
        log(`[${getTime()}] [AutoGem] Inventory empty or unavailable.`);
        return;
      }

      // Filter for gemmable items that exceed the set threshold
      const itemsToConvert = inventory.filter((item) => {
        const type = item.type?.toLowerCase() || '';
        const name = item.market_hash_name?.toLowerCase() || '';

        const isEmoteOrBG = type.includes('profile background') || type.includes('emoticon');
        const skip =
          type.includes('trading card') ||
          name.includes('booster') ||
          name.includes('gems');

        if (isEmoteOrBG && !skip && Array.isArray(item.descriptions)) {
          const gemInfo = item.descriptions.find((d) => d.value?.includes('This item is worth:'));
          if (gemInfo) {
            const match = gemInfo.value.match(/(\d+)\s*Gems?/i);
            if (match) {
              const gemValue = parseInt(match[1], 10); 
              return gemValue > CONFIG.Restrictions.Convert_To_Gems;
            }
          }
        }
        return false;
      });

      let gemmedCount = 0;

      // Convert items sequentially with throttling
      await itemsToConvert.reduce(async (previousPromise, item) => {
        await previousPromise; 

        const gemInfo = item.descriptions.find((d) => d.value?.includes('This item is worth:'));
        const match = gemInfo.value.match(/(\d+)\s*Gems?/i);
        const gemValue = parseInt(match[1], 10);

        log(`[${getTime()}] [AutoGem] Converting ${item.market_hash_name} (${gemValue} gems)...`);
        gemmedCount = gemmedCount + 1; 

        // HTTP request to grind item into gems
        await new Promise((resolve) => {
          community.httpRequestPost(
            {
              uri: 'https://steamcommunity.com/market/grindintogoo/',
              formData: {
                sessionid: sessionID,
                appid: String(item.appid),
                assetid: String(item.assetid),
                contextid: String(item.contextid),
              },
            },
            (err, res) => {
              if (err || res.statusCode !== 200) {
                logError(
                  `[${getTime()}] [AutoGem] Error converting ${item.market_hash_name}: ${err || res.statusCode}`
                );
              }
              resolve();
            }
          );
        });

        // Throttle request rate (1000ms)
        await new Promise((r) => setTimeout(r, 1000));

        return Promise.resolve();
      }, Promise.resolve()); 

      log(`[${getTime()}] [AutoGem] Finished converting ${gemmedCount} items this run.`);
    } catch (err) {
      logError(`[${getTime()}] [AutoGem] Error:`, err.message);
    }
  }

  // Processes incoming trade offers
  function ProccessTradeOffer(offer) {
    const PartnerID = offer.partner.getSteamID64();
    offer.getUserDetails((error) => {
      if (error) {
        return logError(
          `[${getTime()}] An error occured while processing a trade : ${error}`,
        );
      }
      
      // Auto-accept admin trades
      if (CONFIG.Owner.indexOf(PartnerID) >= 0) {
        return offer.accept((errAccept) => {
          if (errAccept) {
            logError(
              `[${getTime()}] Error occured while auto accepting admin trades : ${errAccept}`,
            );
            return; 
          }
          log(`[${getTime()}] [Accepted Offer] | ${PartnerID}`); 
        });
      }
      
      // Auto-accept donations
      if (offer.itemsToGive.length === 0) {
        return offer.accept((errAccept) => {
          if (errAccept) {
            logError(
              `[${getTime()}] Error occured accepting donations : ${errAccept}`,
            );
            return; 
          }
          log(`[${getTime()}] [Donation Accepted] | ${PartnerID}`); 
          client.chatMessage(PartnerID, 'Your donation is appreciated!');
        });
      }
      
      // Logic for item-based trades
      if (offer.itemsToReceive.length > 0) {
        const MyItems = offer.itemsToGive;
        // Check for empty array just in case
        if (MyItems.length === 0) {
            return offer.decline();
        }
        const tag = MyItems[0].type;
        const TheirItems = offer.itemsToReceive;
        const tag2 = TheirItems[0].type;
        
        // Selling the bot's BGs/Emotes for the user's Gems
        if (tag.includes('Profile Background') || tag.includes('Emoticon')) {
          Sell_Bgs_And_Emotes(offer);
          return; 
        }
        
        // Buying the user's BGs/Emotes for the bot's Gems
        if (
          tag2.includes('Profile Background')
          || tag2.includes('Emoticon')
        ) {
          Buy_Bgs_And_Emotes(offer);
          return; 
        }
      }
      
      // Ignore offers from users on the ignore list
      if (CONFIG.Ignore_Msgs.indexOf(PartnerID) >= 0) {
        log(`[${getTime()}] [Ignored Offer] | ${PartnerID} is on ignore list.`);
        return; 
      }
      
      // Decline all other offers (empty, invalid, non-BG/Emote item trades)
      return offer.decline((errDecline) => {
        if (errDecline) {
          logError(
            `[${getTime()}] Error declining the trade offer : ${errDecline}`,
          );
          return; 
        }
        log(`[${getTime()}] [Declined Offer] (Invalid Items) | ${PartnerID}`); 
      });
    });
  }

  // Spam Filter: checks for message spam every second
  setInterval(() => {
    for (let i = 0; i < Object.keys(userMsgs).length; i = i + 1) { 
      if (userMsgs[Object.keys(userMsgs)[i]] > CONFIG.MAXMSGPERSEC) {
        client.chatMessage(
          Object.keys(userMsgs)[i],
          "Sorry but we do not like spamming. You've been removed!",
        );
        client.removeFriend(Object.keys(userMsgs)[i]);
        for (let j = 0; j < CONFIG.Owner.length; j = j + 1) { 
          client.chatMessage(
            CONFIG.Owner[j],
            `Steam #${Object.keys(userMsgs)[i]} has been removed for spamming`,
          );
        }
      }
    }
    userMsgs = {};
  }, 1000);

  // Initial console cleanup and header (DEBUG/LICENSE)
  console.clear();
  log('\x1b[32m///////////////////////////////////////////////////////////////////////////\x1b[0m');
  log('\x1b[31mCopyright (C) 2025 killerboyyy777\x1b[0m');
  log('\x1b[31mhttps://steamcommunity.com/id/klb777\x1b[0m');
  log('\x1b[32m///////////////////////////////////////////////////////////////////////////\x1b[0m');
  
  // Initialize JSON Profit file
  InitJSON();

  // DEBUG: Logging in
  log('[DEBUG] Logging in with:', {
    accountName: CONFIG.USERNAME,
    password: CONFIG.PASSWORD ? '***' : 'MISSING',
    sharedSecret: CONFIG.SHAREDSECRET ? 'OK' : 'MISSING',
    SteamApiKey: CONFIG.STEAMAPIKEY ? 'OK' : 'MISSING',
  });

  // Log in to Steam
  client.logOn({
    accountName: CONFIG.USERNAME,
    password: CONFIG.PASSWORD,
    twoFactorCode: SteamTotp.getAuthCode(CONFIG.SHAREDSECRET),
  });

  // Handle successful Steam login
  client.on('loggedOn', () => {
    if (CONFIG.Owner[0]) {
      client.getPersonas([client.steamID], () => {
        log(`[${getTime()}] Successfully Logged Into Your Bot Account`);
        client.setPersona(1); // Set status to Online (1)
      });
    } else {
      client.logOff();
    }
  });

  // Handle successful web session
  client.on('webSession', async (sessionID, cookies) => {
    manager.setCookies(cookies);
    community.setCookies(cookies);
    community.startConfirmationChecker(15000, CONFIG.IDENTITYSECRET);

    log(`[${getTime()}] [AutoGem] Starting initial AutoGem check...`);
    await autoGemItems();

    // Repeat Autogem once per Week
    setInterval(() => {
      log(`[${getTime()}] [AutoGem] Running weekly AutoGem check...`);
      autoGemItems();
    }, 7 * 24 * 60 * 60 * 1000); // 1 Week interval

    // Accept pending friend requests
    for (let i = 0; i < Object.keys(client.myFriends).length; i = i + 1) { 
      if (client.myFriends[Object.keys(client.myFriends)[i]] === 2) { 
        client.addFriend(Object.keys(client.myFriends)[i]);
      }
    }

    // Update 'playing' message
    RefreshInventory();
  });

  // Handle new friend requests
  client.on('friendRelationship', (SENDER, REL) => {
    community.getSteamUser(SENDER, (error, user) => { 
      if (error) {
        return logError(
          `[${getTime()}] Error checking current friend relationship: ${error}`,
        );
      }
      if (REL === 2) { // New friend request
        log(
          `[${getTime()}] [New Friend] - ${user.name} > ${SENDER.getSteamID64()} - SteamID`,
        );
        client.addFriend(SENDER);
      } else if (REL === 3) { // Friend accepted
        if (CONFIG.INVITETOGROUPID) {
          client.inviteToGroup(SENDER, CONFIG.INVITETOGROUPID);
          client.chatMessage(SENDER, CONFIG.MESSAGES.WELCOME);
        }
      }
      return null; 
    });
  });

  // Handle session expiration
  community.on('sessionExpired', (error) => { 
    if (!error) {
      log(`[${getTime()}] Session Expired. Relogging.`); 
      client.webLogOn();
    }
  });

  // Handle new mobile trade confirmations
  community.on('newConfirmation', (CONF) => {
    log('## New confirmation.'); 
    community.acceptConfirmationForObject(
      CONFIG.IDENTITYSECRET,
      CONF.id,
      (error) => { 
        if (error) {
          logError(
            `## An error occurred while accepting confirmation: ${error}`,
          );
        } else {
          log('## Confirmation accepted.'); 
        }
      },
    );
  });

  // Handle new trade offers
  manager.on('newOffer', (offer) => {
    offer.getUserDetails((error) => { 
      if (error) return logError(`[${getTime()}] ${error}`);
      log(
        `[${getTime()}] [New Trade Offer] From: ${offer.partner.getSteamID64()}`,
      );
      ProccessTradeOffer(offer);
    });
  });

  // Handle chat messages and commands
  client.on('friendMessage', (SENDER, MSG) => {
    const steamID64 = SENDER.getSteamID64(); 

    if (CONFIG.Ignore_Msgs.indexOf(steamID64) < 0) {
      community.getSteamUser(SENDER, (error, user) => { 
        if (error) {
          return logError(
            `[${getTime()}] Failure parsing users Steam Info: ${error}`,
          );
        }
        log(
          `[${getTime()}] [Incoming Chat Message] ${
          user.name
          } > ${steamID64} : ${MSG}`,
        );
        
        // Spam counter update
        if (userMsgs[steamID64]) {
          userMsgs[steamID64] = userMsgs[steamID64] + 1; 
        } else {
          userMsgs[steamID64] = 1;
        }
        
        // --- Admin Commands ---
        if (CONFIG.Owner.indexOf(steamID64) >= 0) {
          if (MSG.toUpperCase() === '!ADMIN') {
            client.chatMessage(SENDER, CONFIG.MESSAGES.ADMINHELP);
            return null;
          
          } else if (MSG.toUpperCase() === '!PROFIT') {
            // Profit command from index2.js (cleaned up)
            try {
              const Database = JSON.parse(
                fs
                  .readFileSync('./SETTINGS/TotalSold.json')
                  .toString('utf8'),
              );
              const Bought = Database.Profit.Buy;
              const Sold = Database.Profit.Sell;
              
              // Calculate totals (only TF2 and CRAP)
              const total_Bought_Daily = Bought.TF2[1] + Bought.CRAP[1];
              const total_Sold_Daily = Sold.TF2[1] + Sold.CRAP[1];
              const total_Bought_Lifetime = Bought.TF2[0] + Bought.CRAP[0];
              const total_Sold_Lifetime = Sold.TF2[0] + Sold.CRAP[0];
              
              let content = "-------------------------------\r\nYour Bot's Activity Today:\r\n\r\n";
              content += `- Profited ${total_Bought_Daily} Gems from Buy Features\r\n- Profited ${total_Sold_Daily} Gems from Sell Features\r\n\r\nActivity since the start:\r\n\r\n- Profited ${total_Bought_Lifetime} Gems from Buy Features\r\n- Profited ${total_Sold_Lifetime} Gems from Sell Features\r\n-------------------------------\r\n\r\n ↧↧↧\r\n\r\n[Buy Features Activity Today ★] \r\n-------------------------------\r\n✔ ${Bought.TF2[1]} Gems Profit ► !BuyTF  |  ( ► Lifetime Profit: ${Bought.TF2[0]} Gems)\r\n✔ ${Bought.CRAP[1]} Gems Profit ► (BG/Emote Trades)  |  ( ► Lifetime Profit: ${Bought.CRAP[0]} Gems)`;
              content += '\r\n\r\n\r\n';
              content += `[Sell Commands Activity Today ★]\r\n-------------------------------\r\n✔ ${Sold.TF2[1]} Gems Profit ► !SellTF  |  ( ► Lifetime Profit: ${Sold.TF2[0]} Gems)\r\n✔ ${Sold.CRAP[1]} Gems Profit ► (BG/EMOTE Trades)  |  ( ► Lifetime Profit: ${Sold.CRAP[0]} Gems)\r\n\r\n`;
              client.chatMessage(SENDER, content);

            } catch (e) {
              logError(`[${getTime()}] [!PROFIT] Error reading TotalSold.json: ${e.message}`);
              client.chatMessage(SENDER, 'Error: Could not read profit file.');
            }
            return null; // Stop processing

          } else if (MSG.toUpperCase().startsWith('!BLOCK ')) {
            // Block command from index2.js
            const n = MSG.toUpperCase().replace('!BLOCK ', '').toString();
            if (SID64REGEX.test(n)) {
              if (CONFIG.Owner.indexOf(n) >= 0) {
                 client.chatMessage(SENDER, 'Admins cannot be blocked.');
                 return null;
              }
              client.chatMessage(SENDER, 'User blocked and unfriended.');
              client.removeFriend(n);
              client.blockUser(n);
              log(`[${getTime()}] [Admin] User ${n} hard-blocked by ${steamID64}.`);
            } else {
              client.chatMessage(
                SENDER,
                '[Error]  Please provide a valid SteamID64',
              );
            }
            return null; // Stop processing

          } else if (MSG.toUpperCase().startsWith('!UNBLOCK ')) {
            // Unblock command from index2.js
            const n = MSG.toUpperCase().replace('!UNBLOCK ', '').toString();
            if (SID64REGEX.test(n)) {
              client.chatMessage(SENDER, 'User UnBlocked + Friended');
              client.unblockUser(n, (err) => {
                 if (err) {
                     logError(`[${getTime()}] [Admin] Error unblocking ${n}: ${err.message}`);
                     client.chatMessage(SENDER, `Error unblocking: ${err.message}`);
                     return;
                 }
                 log(`[${getTime()}] [Admin] User ${n} unblocked by ${steamID64}.`);
                 sleep(2000); // Wait for unblock to process
                 client.addFriend(n, (errFriend, name) => {
                    if (errFriend) {
                        logError(`[${getTime()}] [Admin] Error re-adding ${n}: ${errFriend.message}`);
                        return;
                    }
                    if (name) {
                        log(`[${getTime()}] [Admin] User ${name} (${n}) friended.`);
                    }
                 });
              });
            } else {
              client.chatMessage(SENDER, 'Please provide a valid SteamID64');
            }
            return null; // Stop processing
          
          } else if (MSG.toUpperCase().startsWith('!BROADCAST ')) {
            // Broadcast command from my index.js
            const broadcastMsg = MSG.substring(11).trim();
            if (broadcastMsg.length === 0) {
              client.chatMessage(SENDER, 'Please provide a message. Usage: !Broadcast [Message]');
              return null;
            }
            
            let friendCount = 0;
            const friendSteamIDs = Object.keys(client.myFriends);
            
            log(`[${getTime()}] [Admin] Starting broadcast from ${steamID64}...`);
            friendSteamIDs.forEach((friendID, index) => {
              if (client.myFriends[friendID] === 3) { // SteamUser.EFriendRelationship.Friend
                setTimeout(() => {
                  client.chatMessage(friendID, broadcastMsg);
                }, index * 500); // 500ms delay
                friendCount++;
              }
            });
            
            client.chatMessage(SENDER, `Broadcast sending to ${friendCount} friends.`);
            log(`[${getTime()}] [Admin] Broadcast sent to ${friendCount} friends: "${broadcastMsg}"`);
            return null; // Stop processing
          }
        } // --- End Admin Commands ---

        
        // --- User Commands ---
        
        if (MSG.toUpperCase() === '!HELP') {
          client.chatMessage(SENDER, CONFIG.MESSAGES.HELP);
        } else if (
          MSG.toUpperCase() === '!PRICE' || 
          MSG.toUpperCase() === '!RATE' || 
          MSG.toUpperCase() === '!RATES' || 
          MSG.toUpperCase() === '!PRICES'
        ) {
          client.chatMessage(
            SENDER,
            `Sell Your: \r\n1 TF2 Key for Our ${CONFIG.Rates.SELL.TF2_To_Gems} Gems\r\n\r\nBuy Our: \r\n1 TF2 Key for Your ${CONFIG.Rates.BUY.Gems_To_TF2_Rate} Gems\r\n\r\nWe're also:\r\nBuying Your Backgrounds & emotes for ${CONFIG.Rates.BUY.BG_And_Emotes} Gems (Send offer & add correct number of my gems for auto accept.)\r\nSelling any of OUR Backgrounds & emotes for ${CONFIG.Rates.SELL.BG_And_Emotes} Gems (Send offer & add correct number of my gems for auto accept.)`,
          );
        } else if (MSG.toUpperCase() === '!INFO') { 
          client.chatMessage(
            SENDER,
            `Bot owned by https://steamcommunity.com/id/klb777\r\n1 Use !help to see all Commands`,
          );
        } else if (MSG.toUpperCase() === '!CHECK') {
          let theirTF2 = 0;
          let theirGems;
          
          manager.getUserInventoryContents(
            steamID64,
            440,
            2,
            true,
            (error, INV) => { 
              if (error) {
                logError(error); 
                return; 
              }
              for (let i = 0; i < INV.length; i = i + 1) { 
                if (CONFIG.TF2_Keys.indexOf(INV[i].market_hash_name) >= 0) {
                  theirTF2 = theirTF2 + 1; 
                }
              }
              
              manager.getUserInventoryContents(
                steamID64,
                753,
                6,
                true,
                (error3, INV3) => { 
                  if (error3) {
                    logError(error); 
                    return; 
                  }
                  const TheirGems = INV3.filter((gem) => gem.name === 'Gems'); 
                  if (TheirGems === undefined || TheirGems.length === 0) { 
                    theirGems = 0;
                  } else {
                    const gem = TheirGems[0];
                    theirGems = gem.amount;
                  }
                  
                  let tf2Msg = ''; 
                  let gemsMsg = ''; 
                  
                  if (theirTF2 > 0) {
                    tf2Msg = `- I can give you ${ 
                      theirTF2 * CONFIG.Rates.SELL.TF2_To_Gems
                      } Gems for them (Use !SellTF ${theirTF2})`;
                  }
                  
                  if (
                    Math.floor(theirGems / CONFIG.Rates.BUY.Gems_To_TF2_Rate)
                    > 0
                  ) {
                    gemsMsg = `- I can give you ${Math.floor( 
                      theirGems / CONFIG.Rates.BUY.Gems_To_TF2_Rate,
                    )} TF2 Keys for Your ${
                      Math.floor(
                        theirGems / CONFIG.Rates.BUY.Gems_To_TF2_Rate,
                      ) * CONFIG.Rates.BUY.Gems_To_TF2_Rate
                      } Gems (Use !BuyTF ${Math.floor(
                        theirGems / CONFIG.Rates.BUY.Gems_To_TF2_Rate,
                      )})`;
                  }
                  
                  client.chatMessage(
                    SENDER,
                    `You have:\r\n\r\n${theirTF2} TF2 Keys\r\n${tf2Msg}\r\nYou have:\r\n\r\n${theirGems} Gems ${gemsMsg}`, 
                  );
                  return null; 
                },
              );
              return null; 
            },
          );
        } else if (MSG.toUpperCase().indexOf('!SELLTF') >= 0) {
          // Command: Sell TF2 Keys for Gems (from index2.js)
          let n = MSG.toUpperCase().replace('!SELLTF ', '');
          const Amount_of_Gems = parseInt(n, 10) * CONFIG.Rates.SELL.TF2_To_Gems;
          const TheirKeys = [];
          if (!isNaN(n) && parseInt(n, 10) > 0) {
            if (n <= CONFIG.Restrictions.MaxSell || CONFIG.Restrictions.MaxSell === 0) {
              const t = manager.createOffer(SENDER.getSteamID64());
              t.getUserDetails((ERR, ME, THEM) => {
                if (ERR) {
                  logError(
                    `## An error occurred while getting trade holds: ${ERR}`,
                  );
                  client.chatMessage(
                    SENDER,
                    'An error occurred while getting your trade holds. Please Enable your Steam Guard!',
                  );
                } else if (ME.escrowDays == 0 && THEM.escrowDays == 0) {
                  n = parseInt(n, 10);
                  client.chatMessage(
                    SENDER,
                    `You Requested To Sell Your ${n} TF2 Keys for My ${Amount_of_Gems} Gems`,
                  );
                  sleep(1500);
                  client.chatMessage(SENDER, 'Trade Processing');
                  sleep(1500);
                  client.chatMessage(SENDER, 'Please hold...');
                  sleep(1500);
                  manager.getInventoryContents(753, 6, true, (ERR, MyInv) => {
                    if (ERR) { // Changed 'err' to 'ERR' to match scope
                      client.chatMessage(
                        SENDER,
                        'Inventory refresh in session. Try again shortly please.',
                      );
                      return logError(`[${getTime()}] ${ERR}`);
                    }
                    const MyGems = MyInv.filter((gem) => gem.name == 'Gems');
                    if (MyGems === undefined || MyGems.length == 0) {
                      client.chatMessage(
                        SENDER,
                        `Sorry, I don't have enough Gems to make this trade: 0 / ${Amount_of_Gems}, I'll restock soon!`,
                      );
                    } else {
                      const gem = MyGems[0];
                      const gemDifference = Amount_of_Gems - gem.amount;
                      if (gemDifference <= 0) {
                        gem.amount = Amount_of_Gems;
                        t.addMyItem(gem);
                        ///
                        manager.getUserInventoryContents(
                          SENDER.getSteamID64(),
                          440,
                          2,
                          true,
                          (ERR2, Inv) => {
                            if (ERR2) {
                              return logError(ERR2);
                            }
                            ///
                            for (let i = 0; i < Inv.length; i += 1) {
                              if (
                                TheirKeys.length < n
                                && CONFIG.TF2_Keys.indexOf(
                                  Inv[i].market_hash_name,
                                ) >= 0
                              ) {
                                TheirKeys.push(Inv[i]);
                              }
                            }
                            if (TheirKeys.length != n) {
                              if (TheirKeys.length > 0) {
                                client.chatMessage(
                                  SENDER,
                                  `You don't have enough TF2 keys to make this trade: ${TheirKeys.length} / ${n}\r\nTip: Try using !SellTF ${TheirKeys.length}`,
                                );
                              } else {
                                client.chatMessage(
                                  SENDER,
                                  `You don't have enough TF2 keys to make this trade: ${TheirKeys.length} / ${n}`,
                                );
                              }
                            } else {
                              t.addTheirItems(TheirKeys);
                              t.setMessage('!SellTF - Enjoy your Gems! Have a good day :)');
                              t.send((ERR) => {
                                if (ERR) {
                                  client.chatMessage(
                                    SENDER,
                                    'Inventory refresh in session. Try again shortly please.',
                                  );
                                  logError(
                                    `## An error occurred while sending trade : ${ERR}`,
                                  );
                                } else {
                                  log(
                                    `[${getTime()}] [!SellTF] Trade Offer Sent!`,
                                  );
                                }
                              });
                            }
                          },
                        );
                      } else if (
                        Math.floor(gem.amount / CONFIG.Rates.SELL.TF2_To_Gems) > 0
                      ) {
                        client.chatMessage(
                          SENDER,
                          `Sorry, I don't have enough Gems to make this trade: ${
                          gem.amount
                          } / ${Amount_of_Gems}\r\nTip: Try using !SellTF ${Math.floor(
                            gem.amount / CONFIG.Rates.SELL.TF2_To_Gems,
                          )}`,
                        );
                      } else {
                        client.chatMessage(
                          SENDER,
                          `Sorry, I don't have enough Gems to make this trade: ${gem.amount} / ${Amount_of_Gems}, I'll restock soon!`,
                        );
                      }
                    }
                  });
                } else {
                  client.chatMessage(
                    SENDER,
                    'Make sure you do not have any Trade Holds.',
                  );
                }
              });
            } else {
              client.chatMessage(
                SENDER,
                `You can only Sell up to ${CONFIG.Restrictions.MaxSell} TF2 Keys to me at a time!`,
              );
            }
          } else {
            client.chatMessage(
              SENDER,
              'Please provide a valid amount of Keys -> !SellTF [Number of Keys]',
            );
          }
        } else if (MSG.toUpperCase().indexOf('!BUYTF') >= 0) {
          // Command: Buy TF2 Keys for Gems (from index2.js)
          const n = MSG.toUpperCase().replace('!BUYTF ', '');
          const Amount_of_Gems = parseInt(n, 10) * CONFIG.Rates.BUY.Gems_To_TF2_Rate;
          const MyKeys = [];
          if (!isNaN(n) && parseInt(n, 10) > 0) {
            if (n <= CONFIG.Restrictions.MaxBuy || CONFIG.Restrictions.MaxBuy === 0) {
              const t = manager.createOffer(SENDER.getSteamID64());
              t.getUserDetails((ERR, ME, THEM) => {
                if (ERR) {
                  logError(
                    `## An error occurred while getting trade holds: ${ERR}`,
                  );
                  client.chatMessage(
                    SENDER,
                    'An error occurred while getting your trade holds. Please Enable your Steam Guard!',
                  );
                } else if (ME.escrowDays == 0 && THEM.escrowDays == 0) {
                  client.chatMessage(
                    SENDER,
                    `You Requested To Buy My ${n} TF2 Keys for your ${Amount_of_Gems} Gems`,
                  );
                  sleep(1500);
                  client.chatMessage(SENDER, 'Trade Processing');
                  sleep(1500);
                  client.chatMessage(SENDER, 'Please hold...');
                  sleep(1500);
                  manager.getUserInventoryContents(
                    SENDER.getSteamID64(),
                    753,
                    6,
                    true,
                    (ERR, INV) => {
                      if (ERR) { // Changed 'err' to 'ERR'
                        logError(`[${getTime()}] ${ERR}`);
                        client.chatMessage(
                          SENDER,
                          "I can't load your Steam Inventory. Is it private? \r\n If it's not private, then please try again in a few seconds.",
                        );
                        return;
                      }
                      const TheirGems = INV.filter((gem) => gem.name == 'Gems');
                      if (typeof TheirGems[0] === 'undefined') {
                        client.chatMessage(
                          SENDER,
                          `You don't have enough Gems to make this trade: 0 / ${Amount_of_Gems}`,
                        );
                      } else {
                        const gem = TheirGems[0];
                        const gemDifference = Amount_of_Gems - gem.amount;
                        if (gemDifference <= 0) {
                          gem.amount = Amount_of_Gems;
                          t.addTheirItem(gem);
                          manager.getInventoryContents(
                            440,
                            2,
                            true,
                            (ERR2, MyInv) => {
                              if (ERR2) {
                                return logError(ERR2);
                              }
                              ///
                              for (let i = 0; i < MyInv.length; i += 1) {
                                if (
                                  MyKeys.length < n
                                  && CONFIG.TF2_Keys.indexOf(
                                    MyInv[i].market_hash_name,
                                  ) >= 0
                                ) {
                                  MyKeys.push(MyInv[i]);
                                }
                              }
                              if (MyKeys.length != n) {
                                if (MyKeys.length > 0) {
                                  client.chatMessage(
                                    SENDER,
                                    `Sorry, I don't have enough TF2 keys to make this trade: ${MyKeys.length} / ${n}\r\nTip: Try using !BuyTF ${MyKeys.length}`,
                                  );
                                } else {
                                  client.chatMessage(
                                    SENDER,
                                    `Sorry, I don't have enough TF2 keys to make this trade: ${MyKeys.length} / ${n}, I'll restock soon!`,
                                  );
                                }
                              } else {
                                t.addMyItems(MyKeys);
                                t.setMessage('!BuyTF - Enjoy your TF2 Keys :)');
                                t.send((ERR) => {
                                  if (ERR) {
                                    client.chatMessage(
                                      SENDER,
                                      'Inventory refresh in session. Try again shortly please.',
                                    );
                                    logError(
                                      `## An error occurred while sending trade: ${ERR}`,
                                    );
                                  } else {
                                    log(
                                      `[${getTime()}] [!BuyTF] Trade Offer Sent!`,
                                    );
                                  }
                                });
                              }
                            },
                          );
                        } else if (
                          Math.floor(
                            gem.amount / CONFIG.Rates.BUY.Gems_To_TF2_Rate,
                          ) > 0
                        ) {
                          client.chatMessage(
                            SENDER,
                            `You don't have enough Gems to make this trade: ${
                            gem.amount
                            } / ${Amount_of_Gems}\r\nTip: Try using !BuyTF ${Math.floor(
                              gem.amount / CONFIG.Rates.BUY.Gems_To_TF2_Rate,
                            )}`,
                          );
                        } else {
                          client.chatMessage(
                            SENDER,
                            `You don't have enough Gems to make this trade: ${gem.amount} / ${Amount_of_Gems}`,
                          );
                        }
                      }
                    },
                  );
                } else {
                  client.chatMessage(
                    SENDER,
                    'Make sure you do not have any Trade Holds.',
                  );
                }
              });
            } else {
              client.chatMessage(
                SENDER,
                `You can only buy up to ${CONFIG.Restrictions.MaxBuy} TF2 Keys From me at a time!`,
              );
            }
          } else {
            client.chatMessage(
              SENDER,
              'Please provide a valid amount of Keys -> !BuyTF [Number of Keys]',
            );
          }
        }
        return null; 
      });
    }
  });

  // Function to refresh inventory and update playing status (from index2.js)
  function RefreshInventory() {
    manager.getInventoryContents(753, 6, true, (ERR, INV) => {
      if (ERR) {
        logError(`Error Refreshing Inventory : ${ERR}`);
      } else {
        let My_gems = 0;
        const MyGems = INV.filter((gem) => gem.name == 'Gems');
        if (typeof MyGems[0] !== 'undefined') {
          const gem = MyGems[0];
          My_gems = gem.amount;
        }
        const playThis = `${+My_gems} Gems > Buy/Sell Gems (!prices)`;
        client.gamesPlayed(playThis, true);
      }
    });
  }

  // Handle accepted trades and log profit (from index2.js, cleaned up)
  manager.on('sentOfferChanged', (OFFER, OLDSTATE) => {
    const TradeType = OFFER.message;
    if (OFFER.state == 3) { // 3 = Accepted
      const MyItems = OFFER.itemsToGive;
      const TheirItems = OFFER.itemsToReceive;
      const Database = JSON.parse(
        fs.readFileSync('./SETTINGS/TotalSold.json').toString('utf8'),
      );
      
      if (TradeType.includes('!BuyTF')) {
        client.chatMessage(
          OFFER.partner,
          'Trade Complete! Enjoy your Keys and please +rep my profile so others knows I work :) Have a nice day!',
        );
        Comment_User(OFFER.partner);
        client.chatMessage(
          CONFIG.Owner[0], // Send to main owner
          `[Profit] Sold my ${MyItems.length} TF2 Keys for their ${OFFER.itemsToReceive[0].amount} Gems`,
        );
        // Profit = (What user paid in gems) - (What bot pays for keys)
        const Profit = (MyItems.length * CONFIG.Rates.BUY.Gems_To_TF2_Rate) - (MyItems.length * CONFIG.Rates.SELL.TF2_To_Gems);
        Database.Profit.Buy.TF2[0] += Profit;
        Database.Profit.Buy.TF2[1] += Profit;
        Database.Profit.Buy.TF2[2] += Profit;
        fs.writeFileSync(
          './SETTINGS/TotalSold.json',
          JSON.stringify(Database, undefined, '\t'),
        );
      } else if (TradeType.includes('!SellTF')) {
        // *** THIS BLOCK IS FIXED ***
        Comment_User(OFFER.partner);
        client.chatMessage(
          OFFER.partner,
          'Trade Complete! Enjoy your Gems and please +rep my profile so others knows I work :) Have a nice day!',
        );
        client.chatMessage(
          CONFIG.Owner[0], // Send to main owner
          `[Profit] Bought his ${TheirItems.length} TF2 Keys for My ${OFFER.itemsToGive[0].amount} Gems`,
        );
        // Profit = (What bot sells keys for) - (What user was paid in gems)
        const Profit = (TheirItems.length * CONFIG.Rates.BUY.Gems_To_TF2_Rate) - (TheirItems.length * CONFIG.Rates.SELL.TF2_To_Gems);
        Database.Profit.Sell.TF2[0] += Profit; // Was Buy.CSGO[0]
        Database.Profit.Sell.TF2[1] += Profit; // Was Buy.CSGO[1]
        Database.Profit.Sell.TF2[2] += Profit; // Was Buy.CSGO[2]
        fs.writeFileSync(
          './SETTINGS/TotalSold.json',
          JSON.stringify(Database, undefined, '\t'),
        );
      }
      RefreshInventory();
    }
  });

  // Post comment on user's profile (from index2.js)
  function Comment_User(SteamID) {
    if (!CONFIG.Comment_After_Trade) {
        return; // Do nothing if config is empty
    }
    community.getSteamUser(SteamID, (ERR, USER) => {
      if (ERR) {
        logError(
          `## An error occurred while getting user profile: Usually private. ${ERR}`,
        );
      } else {
        USER.comment(CONFIG.Comment_After_Trade, (ERR) => {
          if (ERR) {
            logError(
              `## An error occurred while commenting on user profile: comments disabled for any reason. ${ERR}`,
            );
          }
        });
      }
    });
  }

  // Sell BGs/Emotes logic (from index2.js)
  function Sell_Bgs_And_Emotes(offer) {
    const PartnerID = offer.partner.getSteamID64();
    const MyItems = offer.itemsToGive;
    const TheirItems = offer.itemsToReceive;
    let My_Bg_And_Emote = 0;
    let Price_In_Gems = 0;
    for (let i = 0; i < MyItems.length; i += 1) {
      const MyItem = MyItems[i];
      const tag = MyItem.type;
      if (tag.includes('Profile Background') || tag.includes('Emoticon')) {
        if (!CONFIG.Restrictions.ItemsNotForTrade.includes(MyItem.name)) {
          My_Bg_And_Emote += 1;
        }
      }
    }
    Price_In_Gems = My_Bg_And_Emote * CONFIG.Rates.SELL.BG_And_Emotes;
    if (offer.itemsToGive.length == My_Bg_And_Emote && My_Bg_And_Emote > 0) {
      const TheirGems = TheirItems.filter((gem) => gem.name == 'Gems');
      if (typeof TheirGems[0] === 'undefined') {
        offer.decline((err) => {
          if (err) {
            logError(`[${getTime()}] ${err}`);
          }
        });
      } else {
        const gem = TheirGems[0];
        if (gem.amount >= Price_In_Gems) {
          const Database = JSON.parse(
            fs
              .readFileSync('./SETTINGS/TotalSold.json')
              .toString('utf8'),
          );
          // Profit = (Gems received) - (Gems paid for them, if we bought them)
          const Profit = (MyItems.length * CONFIG.Rates.SELL.BG_And_Emotes) - (MyItems.length * CONFIG.Rates.BUY.BG_And_Emotes);
          Database.Profit.Sell.CRAP[0] += Profit;
          Database.Profit.Sell.CRAP[1] += Profit;
          Database.Profit.Sell.CRAP[2] += Profit;
          fs.writeFileSync('./SETTINGS/TotalSold.json',JSON.stringify(Database, undefined, '\t'),
    );
          offer.accept((err) => {
            if (err) {
              logError(
                `[${getTime()}] Error accepting trade during selling your BG's Emotes : ${err}`,
              );
              return;
            }
            client.chatMessage(
              PartnerID,
              'Trade Complete! Enjoy and please +Rep my profile to let others know I work!',
            );
            RefreshInventory();
            client.chatMessage(
              CONFIG.Owner[0],
              `[${getTime()}] Trade Accepted From : ${PartnerID} - They bought your BGs/Emotes`,
            );
            log(
              `[${getTime()}] Trade Accepted From : ${PartnerID} - Bought your BGs/Emotes`,
            );
            Comment_User(offer.partner);
          });
        } else {
          // Not enough gems,decline
          client.chatMessage(
            PartnerID,
            `Rates are incorrect.You offered ${gem.amount} Gems but this trade requires ${Price_In_Gems} Gems (${MyItems.length} item(s) × ${CONFIG.Rates.SELL.BG_And_Emotes} Gems each). Please retry using the correct rates.`,
          );
          offer.decline((err) => {
            if (err) {
              logError(`[${getTime()}] Error SELLING bgs/emotes : ${err}`);
            }
          });
        }
      }
    } else {
      client.chatMessage(
        PartnerID,
        'Sorry, One or more of the Items are not for sale or you did not add any valid items. Try again please with other items!',
      );
      offer.decline((err) => {
        log(
          `[${getTime()}] `
          + `[SellBG] Declined! ${PartnerID} - They tried to buy something blacklisted or invalid!`,
        );
        if (err) {
          logError(`[${getTime()}] ${err}`);
        }
      });
    }
  }

  // Buy BGs/Emotes logic (from index2.js)
  function Buy_Bgs_And_Emotes(offer) {
    const PartnerID = offer.partner.getSteamID64();
    const MyItems = offer.itemsToGive;
    const TheirItems = offer.itemsToReceive;
    let Their_Bg_And_Emote = 0;
    let Price_In_Gems = 0;
    for (let i = 0; i < TheirItems.length; i += 1) {
      const TheirItem = TheirItems[i];
      const tag = TheirItem.type;
      if (tag.includes('Profile Background') || tag.includes('Emoticon')) {
        if (!CONFIG.Restrictions.ItemsNotForTrade.includes(TheirItem.name)) {
          Their_Bg_And_Emote += 1;
        }
      }
    }
    Price_In_Gems = Their_Bg_And_Emote * CONFIG.Rates.BUY.BG_And_Emotes;
    
    // Check if they only added valid BGs/Emotes and nothing else
    if (offer.itemsToReceive.length == Their_Bg_And_Emote && Their_Bg_And_Emote > 0) {
      const MyGems = MyItems.filter((gem) => gem.name == 'Gems');
      if (typeof MyGems[0] === 'undefined' || offer.itemsToGive.length > 1) {
          client.chatMessage(
            PartnerID,
            'Trade Validation Failed. You can only take Gems for your BGs/Emotes.',
          );
        offer.decline((err) => {
          if (err) {
            logError(
              `[${getTime()}] Error declining trade , Likely steam : ${err}`,
            );
          }
        });
      } else {
        const gem = MyGems[0];
        if (gem.amount <= Price_In_Gems) {
          const Database = JSON.parse(
            fs
              .readFileSync('./SETTINGS/TotalSold.json')
              .toString('utf8'),
          );
        // Profit = (What bot will sell for) - (What bot paid)
        const Profit = (TheirItems.length * CONFIG.Rates.SELL.BG_And_Emotes) - (TheirItems.length * CONFIG.Rates.BUY.BG_And_Emotes);
        Database.Profit.Buy.CRAP[0] += Profit;
        Database.Profit.Buy.CRAP[1] += Profit;
        Database.Profit.Buy.CRAP[2] += Profit;
          fs.writeFileSync(
            './SETTINGS/TotalSold.json',
            JSON.stringify(Database, undefined, '\t'),
          );
          offer.accept((err) => {
            if (err) {
              logError(
                `[${getTime()}] Error accepting trade while buying their bgs/emotes : ${err}`,
              );
              return;
            }
            client.chatMessage(
              PartnerID,
              'Trade Complete! Enjoy and please +Rep my profile to let others know I work!',
            );
            RefreshInventory();
            client.chatMessage(
              CONFIG.Owner[0],
              `[${getTime()}] Trade Accepted From : ${PartnerID} - They sold you BGs/Emotes`,
            );
            log(
              `[${getTime()}] Trade Accepted From : ${PartnerID} - Sold you BGs/Emotes`,
            );
            Comment_User(offer.partner);
          });
        } else {
          client.chatMessage(
            PartnerID,
            `You are trying to take too many Gems. This trade requires ${Price_In_Gems} Gems, but you tried to take ${gem.amount}. Please try again.`,
          );
          offer.decline((err) => {
            if (err) {
              logError(`[${getTime()}] Error BUYING bgs/emotes (too many gems): ${err}`);
            }
          });
        }
      }
    } else {
      client.chatMessage(
        PartnerID,
        'Trade Validation Failed. You can only trade Backgrounds/Emotes for Gems. Make sure you are not trading non-gemmable items or items from the "ItemsNotForTrade" list.',
      );
      offer.decline((err) => {
        log(
          `[${getTime()}] `
          + `[BuyBG] Declined! - ${PartnerID} : Tried to sell non-BG/Emote items.`,
        );
        if (err) {
          logError(`[${getTime()}] ${err}`);
        }
      });
    }
  }

} // End cluster.isWorker