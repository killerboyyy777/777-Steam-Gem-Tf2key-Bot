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

  // ----------------------------------------------------------
  // CORE FUNCTIONS (HOISTED FOR ESLINT)
  // ----------------------------------------------------------

  // Get current time for log timestamps
  function getTime() {
    const time = new Date();
    const hours = String(time.getHours()).padStart(2, '0');
    const minutes = String(time.getMinutes()).padStart(2, '0');
    const seconds = String(time.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  // Custom logging function (kept for debug/info messages)
  function log(...args) {
    // eslint-disable-next-line no-console
    console.log(`[${getTime()}]`, ...args);
  }

  function logError(...args) {
    // eslint-disable-next-line no-console
    console.error(`[${getTime()}] [ERROR]`, ...args);
  }

  // Helper functions (placeholders)
  async function RefreshInventory() {
    // Logic to refresh inventory details
  }
  function CommentUser(user) {
    // Logic to post a comment on user's profile
  }
  async function SellBgsAndEmotes(offer) {
    // Logic for selling the bot's Backgrounds/Emotes for Gems
  }
  async function BuyBgsAndEmotes(offer) {
    // Logic for buying user's Backgrounds/Emotes for Gems
  }

  // Converts unwanted items to gems based on the Convert_To_Gems config
  async function autoGemItems() {
    try {
      log('[AutoGem] Checking inventory for items to convert...');

      const sessionID = community.getSessionID();
      if (!sessionID) {
        log('[AutoGem] No valid session ID yet, skipping.');
        return;
      }

      // Fetch user inventory (App ID 753, Context ID 6 for Steam Community)
      const inventory = await new Promise((resolve, reject) => {
        // Renamed 'err' to 'errInv' to avoid shadowing in a broader scope
        community.getUserInventoryContents(client.steamID, 753, 6, true, (errInv, inv) => {
          if (errInv) return reject(errInv);
          return resolve(inv || []);
        });
      });

      if (inventory.length === 0) {
        log('[AutoGem] Inventory empty or unavailable.');
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
          const gemInfo = item.descriptions.find((d) =>
            d.value?.includes('This item is worth:'));
          if (gemInfo) {
            const match = gemInfo.value.match(/(\d+)\s*Gems?/i);
            if (match) {
              const gemValue = parseInt(match[1], 10);
              return gemValue > CONFIG.Convert_To_Gems;
            }
          }
        }
        return false;
      });

      let gemmedCount = 0;

      // Convert items sequentially with throttling
      await itemsToConvert.reduce(async (previousPromise, item) => {
        await previousPromise;

        const gemInfo = item.descriptions.find((d) =>
          d.value?.includes('This item is worth:'));
        const match = gemInfo.value.match(/(\d+)\s*Gems?/i);
        const gemValue = parseInt(match[1], 10);

        log(`[AutoGem] Converting ${item.market_hash_name} (${gemValue} gems)...`);
        gemmedCount += 1; // Replaced ++

        // HTTP request to grind item into gems
        await new Promise((resolve) => {
          // eslint-disable-next-line no-promise-executor-return
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
                  `[AutoGem] Error converting ${item.market_hash_name}: ${err || res.statusCode}`
                );
              }
              resolve();
            }
          );
        });

        // Throttle request rate
        await new Promise((r) => setTimeout(r, 1000));

        return Promise.resolve();
      }, Promise.resolve());

      log(`[AutoGem] Finished converting ${gemmedCount} items this run.`);
    } catch (err) {
      logError('[AutoGem] Error:', err.message);
    }
  }

  // Processes incoming trade offers
  function ProcessTradeOffer(offer) {
    const partnerID = offer.partner.getSteamID64();
    offer.getUserDetails((error) => {
      if (error) {
        logError(`An error occured while processing a trade : ${error}`);
        return null;
      }

      // Auto-accept admin trades
      if (CONFIG.Owner.includes(partnerID)) {
        return offer.accept((errAccept) => {
          if (errAccept) {
            logError(
              `Error occured while auto accepting admin trades : ${errAccept}`
            );
            return null;
          }
          log(`[Accepted Offer] | ${partnerID}`);
          return null;
        });
      }

      // Auto-accept donations
      if (offer.itemsToGive.length === 0) {
        return offer.accept((errAccept) => {
          if (errAccept) {
            logError(
              `Error occured accepting donations : ${errAccept}`
            );
            return null;
          }
          log(`[Donation Accepted] | ${partnerID}`);
          client.chatMessage(partnerID, 'Your donation is appreciated!');
          return null;
        });
      }

      // Logic for item-based trades
      if (offer.itemsToReceive.length > 0) {
        const myItems = offer.itemsToGive;
        const tag = myItems[0].type;
        const theirItems = offer.itemsToReceive;
        const tag2 = theirItems[0].type;

        // Selling the bot's BGs/Emotes for the user's Gems
        if (tag.includes('Profile Background') || tag.includes('Emoticon')) {
          SellBgsAndEmotes(offer);
          return null;
        }

        // Buying the user's BGs/Emotes for the bot's Gems
        if (
          tag2.includes('Profile Background') ||
          tag2.includes('Emoticon')
        ) {
          BuyBgsAndEmotes(offer);
          return null;
        }

        // Decline all other item-to-item trades
        return offer.decline((errDecline) => {
          if (errDecline) {
            logError(`Error declining the trade offer : ${errDecline}`);
            return null;
          }
          log(`[Declined Offer] | ${partnerID}`);
          return null;
        });
      }

      // Ignore offers from users on the ignore list
      if (CONFIG.Ignore_Msgs.includes(partnerID)) {
        return null;
      }

      // Decline all other offers (empty, invalid, etc.)
      return offer.decline((errDecline) => {
        if (errDecline) {
          logError(`Error declining the trade offer : ${errDecline}`);
          return null;
        }
        log(`[Declined Offer] | ${partnerID}`);
        return null;
      });
    });
  }

  // ----------------------------------------------------------
  // EVENT LISTENERS AND MAIN LOGIC
  // ----------------------------------------------------------

  // Spam Filter: checks for message spam every second
  setInterval(() => {
    // Replaced i = i + 1 with i += 1
    for (let i = 0; i < Object.keys(userMsgs).length; i += 1) {
      if (userMsgs[Object.keys(userMsgs)[i]] > CONFIG.MAXMSGPERSEC) {
        client.chatMessage(
          Object.keys(userMsgs)[i],
          "Sorry but we do not like spamming. You've been removed!",
        );
        client.removeFriend(Object.keys(userMsgs)[i]);
        // Replaced j = j + 1 with j += 1
        for (let j = 0; j < CONFIG.Owner.length; j += 1) {
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
  // console.clear() entfernt, um 'unexpected console statement' Fehler zu beheben.
  log('\x1b[32m///////////////////////////////////////////////////////////////////////////\x1b[0m');
  log('\x1b[31mCopyright (C) 2025 killerboyyy777\x1b[0m');
  log('\x1b[31mhttps://steamcommunity.com/id/klb777\x1b[0m');
  log('\x1b[32m///////////////////////////////////////////////////////////////////////////\x1b[0m');
  log('\x1b[31m777-steam-gem-tf2key-bot Copyright (C) 2025 killerboyyy777\x1b[0m');
  log('\x1b[31mThis program comes with ABSOLUTELY NO WARRANTY\x1b[0m');
  log('\x1b[31mThis is free software, and you are welcome to redistribute it\x1b[0m');
  log('\x1b[31munder certain conditions\x1b[0m');
  log('\x1b[31mFor more Information Check the LICENSE File.\x1b[0m');
  log('\x1b[32m///////////////////////////////////////////////////////////////////////////\x1b[0m');

  // DEBUG: Logging in
  log('[DEBUG] Logging in with:', {
    accountName: CONFIG.USERNAME,
    password: CONFIG.PASSWORD ? '***' : 'MISSING',
    sharedSecret: CONFIG.SHAREDSECRET ? 'OK' : 'MISSING',
    steamApiKey: CONFIG.STEAMAPIKEY ? 'OK' : 'MISSING',
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
        log('Successfully Logged Into Your Bot Account');
        client.setPersona(1); // Set status to Online (1)
      });
    } else {
      client.logOff();
    }
  });

  // Handle successful web session (required for trading and community actions)
  client.on('webSession', async (sessionID, cookies) => {
    // Set Cookies for manager and community
    manager.setCookies(cookies);
    community.setCookies(cookies);

    // Start confirmation checker for trade confirmations
    community.startConfirmationChecker(15000, CONFIG.IDENTITYSECRET);

    // Initial item conversion check
    log('[AutoGem] Starting initial AutoGem check...');
    await autoGemItems();

    // Repeat Autogem once per Week
    setInterval(() => {
      log('[AutoGem] Running weekly AutoGem check...');
      autoGemItems();
    }, 7 * 24 * 60 * 60 * 1000); // 1 Week interval

    // Accept pending friend requests
    // Replaced i = i + 1 with i += 1
    for (let i = 0; i < Object.keys(client.myFriends).length; i += 1) {
      // Friend relation type 2 is 'Pending Friend Request'
      if (client.myFriends[Object.keys(client.myFriends)[i]] === 2) {
        client.addFriend(Object.keys(client.myFriends)[i]);
      }
    }

    // Update 'playing' message with current gem count
    // Renamed 'error' to 'errInv' to avoid shadowing.
    manager.getInventoryContents(753, 6, true, (errInv, INV) => {
      if (errInv) {
        logError('Could not load inventory:', errInv);
      } else {
        let myGems = 0;
        const MyGems = INV.filter((gem) => gem.name === 'Gems');
        if (MyGems.length > 0) {
          myGems = MyGems[0].amount;
        }

        const playThis = `${myGems} Gems > Buy/Sell Gems (!prices)`;
        client.gamesPlayed(playThis, true);
      }
    });
  });

  // Handle new friend requests and send welcome message
  client.on('friendRelationship', (SENDER, REL) => {
    // Renamed 'error' to 'errUser' to avoid shadowing.
    community.getSteamUser(SENDER, (errUser, user) => {
      if (errUser) {
        logError(
          `Failure checking current friend relationship with new customer : ${errUser}`
        );
        return null;
      }
      if (REL === 2) { // New friend request
        log(
          `[New Friend] - ${user.name} > ${SENDER.getSteamID64()} - SteamID`
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
  community.on('sessionExpired', (err) => { // Renamed 'error' to 'err'
    if (!err) {
      log('Session Expired. Relogging.');
      client.webLogOn();
    }
  });

  // Handle new mobile trade confirmations
  community.on('newConfirmation', (CONF) => {
    log('## New confirmation.');
    // Renamed 'error' to 'errConf' to avoid shadowing.
    community.acceptConfirmationForObject(
      CONFIG.IDENTITYSECRET,
      CONF.id,
      (errConf) => {
        if (errConf) {
          logError(
            `## An error occurred while accepting confirmation: ${errConf}`
          );
        } else {
          log('## Confirmation accepted.');
        }
      }
    );
  });

  // Handle new trade offers
  manager.on('newOffer', (offer) => {
    // Renamed 'error' to 'errDetails' to avoid shadowing.
    offer.getUserDetails((errDetails) => {
      if (errDetails) {
        logError(errDetails);
        return null;
      }
      log(
        `[New Trade Offer] From: ${offer.partner.getSteamID64()}`
      );
      ProcessTradeOffer(offer);
      return null;
    });
  });

  // Handle chat messages and commands
  client.on('friendMessage', (SENDER, MSG) => {
    const steamID64 = SENDER.getSteamID64(); // Get SteamID once

    if (!CONFIG.Ignore_Msgs.includes(steamID64)) { // Used .includes() instead of .indexOf()
      // Renamed 'error' to 'errUser' to avoid shadowing.
      community.getSteamUser(SENDER, (errUser, user) => {
        if (errUser) {
          logError(
            `Failure parsing users Steam Info. Possibly illegal ASCII letters in name OR steam failed to : ${errUser}`
          );
          return null;
        }
        log(
          `[Incoming Chat Message] ${
          user.name
          } > ${steamID64} : ${MSG}`
        );

        // Spam counter update
        if (userMsgs[steamID64]) {
          userMsgs[steamID64] += 1; // Replaced ++
        } else {
          userMsgs[steamID64] = 1;
        }

        // --- Admin Commands ---
        if (CONFIG.Owner.includes(steamID64)) { // Used .includes()
          if (MSG.toUpperCase() === '!ADMIN') {
            client.chatMessage(SENDER, CONFIG.MESSAGES.ADMINHELP);
            return null; // Stop processing

          } else if (MSG.toUpperCase() === '!PROFIT') {
            client.chatMessage(SENDER, 'Berechne Profit... (lade Inventare)');
            let myGems = 0;
            let myTF2Keys = 0;

            // 1. Get Gems
            manager.getInventoryContents(753, 6, true, (errGems, invGems) => {
              if (errGems) {
                logError('[!PROFIT] Error loading gem inventory:', errGems);
                client.chatMessage(SENDER, 'Fehler beim Laden des Gem-Inventars.');
                return;
              }
              const MyGems = invGems.filter((gem) => gem.name === 'Gems');
              if (MyGems.length > 0) {
                myGems = MyGems[0].amount;
              }

              // 2. Get TF2 Keys
              // Renamed 'errKeys' to avoid shadowing 'error' if it were present.
              manager.getInventoryContents(440, 2, true, (errKeys, invKeys) => {
                if (errKeys) {
                  logError('[!PROFIT] Error loading TF2 inventory:', errKeys);
                  client.chatMessage(SENDER, 'Fehler beim Laden des TF2-Key-Inventars.');
                  return;
                }

                // Replaced i = i + 1 with i += 1
                for (let i = 0; i < invKeys.length; i += 1) {
                  if (CONFIG.TF2_Keys.includes(invKeys[i].market_hash_name)) { // Used .includes()
                    myTF2Keys += 1; // Replaced ++
                  }
                }

                // 3. Send Report
                client.chatMessage(SENDER, `Aktueller Bestand:\r\n- Gems: ${myGems}\r\n- TF2 Keys: ${myTF2Keys}`);
              });
            });
            return null; // Stop processing

          } else if (MSG.toUpperCase().startsWith('!BLOCK ')) {
            const idToBlock = MSG.substring(7).trim();
            if (SID64REGEX.test(idToBlock)) {
              if (CONFIG.Owner.includes(idToBlock)) { // Used .includes()
                  client.chatMessage(SENDER, 'Ein Admin kann nicht geblockt werden.');
              } else if (CONFIG.Ignore_Msgs.includes(idToBlock)) { // Used .includes()
                client.chatMessage(SENDER, `Benutzer ${idToBlock} ist bereits geblockt.`);
              } else {
                CONFIG.Ignore_Msgs.push(idToBlock); // Add to in-memory config
                client.chatMessage(SENDER, `Benutzer ${idToBlock} wurde für diese Sitzung geblockt.`);
                log(`[Admin] Benutzer ${idToBlock} wurde von ${steamID64} geblockt.`);
              }
            } else {
              client.chatMessage(SENDER, 'Ungültiges SteamID64 Format. Benutze !Block [SteamID64]');
            }
            return null; // Stop processing

          } else if (MSG.toUpperCase().startsWith('!UNBLOCK ')) {
            const idToUnblock = MSG.substring(9).trim();
            if (SID64REGEX.test(idToUnblock)) {
              const index = CONFIG.Ignore_Msgs.indexOf(idToUnblock);
              if (index > -1) {
                CONFIG.Ignore_Msgs.splice(index, 1); // Remove from array
                client.chatMessage(SENDER, `Benutzer ${idToUnblock} wurde entblockt.`);
                log(`[Admin] Benutzer ${idToUnblock} wurde von ${steamID64} entblockt.`);
              } else {
                client.chatMessage(SENDER, `Benutzer ${idToUnblock} wurde nicht in der Block-Liste gefunden.`);
              }
            } else {
              client.chatMessage(SENDER, 'Ungültiges SteamID64 Format. Benutze !Unblock [SteamID64]');
            }
            return null; // Stop processing

          } else if (MSG.toUpperCase().startsWith('!BROADCAST ')) {
            const broadcastMsg = MSG.substring(11).trim();
            if (broadcastMsg.length === 0) {
              client.chatMessage(SENDER, 'Bitte gib eine Nachricht an. Benutze !Broadcast [Nachricht]');
              return null;
            }

            let friendCount = 0;
            const friendSteamIDs = Object.keys(client.myFriends);

            log(`[Admin] Starte Broadcast von ${steamID64}...`);
            // Renamed 'index' to 'idx' to avoid shadowing in a broader scope
            friendSteamIDs.forEach((friendID, idx) => {
              // Send only to actual friends (relation 3)
              if (client.myFriends[friendID] === 3) {
                // Stagger messages to avoid rate limits
                setTimeout(() => {
                  client.chatMessage(friendID, broadcastMsg);
                }, idx * 500); // 500ms delay between each message
                friendCount += 1; // Replaced ++
              }
            });

            client.chatMessage(SENDER, `Broadcast wird an ${friendCount} Freunde gesendet.`);
            log(`[Admin] Broadcast gesendet an ${friendCount} Freunde: "${broadcastMsg}"`);
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
            `Sell Your: \r\n1 TF2 Key for Our ${CONFIG.Rates.SELL.TF2_To_Gems} Gems\r\n\r\nBuy Our: \r\n1 TF2 Key for Your ${CONFIG.Rates.BUY.Gems_To_TF2_Rate} Gems\r\n\r\nWe're also:\r\nBuying Your Backgrounds & emotes for ${CONFIG.Rates.BUY.BG_And_Emotes} Gems (Send offer & add correct number of my gems for auto accept.)\r\nSelling any of OUR Backgrounds & emotes for ${CONFIG.Rates.SELL.BG_And_Emotes} Gems (Send offer & add correct number of my gems for auto accept.)`
          );
        } else if (MSG.toUpperCase() === '!INFO') {
          client.chatMessage(
            SENDER,
            `Bot owned by https://steamcommunity.com/id/klb777\r\n1 Use !help to see all Commands`
          );
        } else if (MSG.toUpperCase() === '!CHECK') {
          let theirTF2 = 0;
          let theirGems;

          // Check TF2 inventory for keys
          // Renamed 'error' to 'errInvKeys' to avoid shadowing.
          manager.getUserInventoryContents(
            steamID64,
            440,
            2,
            true,
            (errInvKeys, INV) => {
              if (errInvKeys) {
                logError(errInvKeys);
                return null; // Return to prevent further execution in this callback
              }
              // Replaced i = i + 1 with i += 1
              for (let i = 0; i < INV.length; i += 1) {
                if (CONFIG.TF2_Keys.includes(INV[i].market_hash_name)) { // Used .includes()
                  theirTF2 += 1; // Replaced ++
                }
              }

              // Check Gems inventory
              // Renamed 'error3' to 'errInvGems' to avoid shadowing.
              manager.getUserInventoryContents(
                steamID64,
                753,
                6,
                true,
                (errInvGems, INV3) => {
                  if (errInvGems) {
                    logError(errInvGems);
                    return null; // Return to prevent further execution in this callback
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

                  // Suggest selling TF2 keys for gems
                  if (theirTF2 > 0) {
                    tf2Msg = `- I can give you ${
                      theirTF2 * CONFIG.Rates.SELL.TF2_To_Gems
                      } Gems for them (Use !SellTF ${theirTF2})`;
                  }

                  // Suggest buying TF2 keys with gems
                  if (
                    Math.floor(theirGems / CONFIG.Rates.BUY.Gems_To_TF2_Rate) > 0
                  ) {
                    gemsMsg = `- I can give you ${Math.floor(
                      theirGems / CONFIG.Rates.BUY.Gems_To_TF2_Rate
                    )} TF2 Keys for Your ${
                      Math.floor(
                        theirGems / CONFIG.Rates.BUY.Gems_To_TF2_Rate
                      ) * CONFIG.Rates.BUY.Gems_To_TF2_Rate
                      } Gems (Use !BuyTF ${Math.floor(
                        theirGems / CONFIG.Rates.BUY.Gems_To_TF2_Rate
                      )})`;
                  }

                  client.chatMessage(
                    SENDER,
                    `You have:\r\n\r\n${theirTF2} TF2 Keys\r\n${tf2Msg}\r\nYou have:\r\n\r\n${theirGems} Gems ${gemsMsg}`
                  );
                  return null;
                }
              );
              return null;
            }
          );
        } else if (MSG.toUpperCase().startsWith('!SELLTF')) {
          // Command: Sell TF2 Keys for Gems
          const n = MSG.toUpperCase().replace('!SELLTF ', '').trim();
          const amountOfGems = parseInt(n, 10) * CONFIG.Rates.SELL.TF2_To_Gems;
          const TheirKeys = [];
          // Check if n is a positive number (using Number.isInteger for robustness)
          if (Number.isInteger(Number(n)) && Number(n) > 0) {
            if (Number(n) <= CONFIG.Restrictions.MaxSell) {
              const t = manager.createOffer(steamID64);
              // Renamed 'error' to 'errDetails' to avoid shadowing.
              t.getUserDetails((errDetails, ME, THEM) => {
                if (errDetails) {
                  logError(`## An error occurred while getting trade holds : ${errDetails}`);
                  client.chatMessage(
                    SENDER,
                    'An error occurred while getting your trade holds. Please Enable your Steam Guard!'
                  );
                  return null;
                }
                // Used !== 0 for strict comparison (Fixes eqeqeq implicitly)
                if (ME.escrowDays === 0 && THEM.escrowDays === 0) {
                  client.chatMessage(
                    SENDER,
                    `You Requested To Sell Your ${n} TF2 Keys for My ${amountOfGems} Gems`
                  );
                  // Trade preparation and sending logic
                  sleep(1500);
                  client.chatMessage(SENDER, 'Trade Processing');
                  sleep(1500);
                  client.chatMessage(SENDER, 'Please hold...');
                  sleep(1500);
                  // Renamed 'callbackError' to 'errInvBot' to avoid shadowing.
                  manager.getInventoryContents(753, 6, true, (errInvBot, MyInv) => {
                    if (errInvBot) {
                      client.chatMessage(
                        SENDER,
                        'Inventory refresh in session. Try again shortly please.'
                      );
                      logError(errInvBot);
                      return null;
                    }
                    const MyGems = MyInv.filter((gem) => gem.name === 'Gems');
                    if (MyGems.length === 0) { // Checking length is safer than undefined
                      // Not enough gems
                      client.chatMessage(
                        SENDER,
                        `Sorry, I don't have enough Gems to make this trade: 0 / ${amountOfGems}, I'll restock soon!`
                      );
                      return null;
                    }
                    const gem = MyGems[0];
                    const gemDifference = amountOfGems - gem.amount;
                    if (gemDifference <= 0) {
                      // Add gems to bot's side
                      gem.amount = amountOfGems;
                      t.addMyItem(gem);

                      // Add user's TF2 keys to their side
                      // Renamed 'error2' to 'errInvUser' to avoid shadowing.
                      manager.getUserInventoryContents(
                        steamID64,
                        440,
                        2,
                        true,
                        (errInvUser, Inv) => {
                          if (errInvUser) {
                            logError(errInvUser);
                            return null;
                          }

                          // Replaced i = i + 1 with i += 1
                          for (let i = 0; i < Inv.length; i += 1) {
                            if (
                              TheirKeys.length < Number(n) &&
                              CONFIG.TF2_Keys.includes(Inv[i].market_hash_name) // Used .includes()
                            ) {
                              TheirKeys.push(Inv[i]);
                            }
                          }
                          // Using Number(n) for strict comparison
                          if (TheirKeys.length !== Number(n)) {
                            // Not enough keys from user
                            if (TheirKeys.length > 0) {
                              client.chatMessage(
                                SENDER,
                                `You don't have enough TF2 keys to make this trade: ${TheirKeys.length} / ${n}\r\n Tip: Try using !SellTF ${TheirKeys.length}`
                              );
                            } else {
                              client.chatMessage(
                                SENDER,
                                `You don't have enough TF2 keys to make this trade: ${TheirKeys.length} / ${n}`
                              );
                            }
                            return null;
                          }
                          // Finalize and send trade offer
                          t.addTheirItems(TheirKeys);
                          t.setMessage('Your Gems Are Ready! Enjoy :)');
                          // Renamed 'sendError' to 'errSend' to avoid shadowing.
                          t.send((errSend) => {
                            if (errSend) {
                              client.chatMessage(
                                SENDER,
                                'Inventory refresh in session. Try again shortly please.'
                              );
                              logError(
                                `## An error occurred while sending trade: ${errSend}`
                              );
                            } else {
                              log('[!SellTF] Trade Offer Sent!');
                            }
                            return null;
                          });
                          return null;
                        }
                      );
                      return null;
                    }
                    // Not enough gems (with suggestion for partial trade)
                    if (
                      Math.floor(gem.amount / CONFIG.Rates.SELL.TF2_To_Gems) > 0
                    ) {
                      client.chatMessage(
                        SENDER,
                        `Sorry, I don't have enough Gems to make this trade: ${
                        gem.amount
                        } / ${amountOfGems}\r\nTip: Try using !SellTF ${Math.floor(
                          gem.amount / CONFIG.Rates.SELL.TF2_To_Gems
                        )}`
                      );
                    } else {
                      client.chatMessage(
                        SENDER,
                        `Sorry, I don't have enough Gems to make this trade: ${gem.amount} / ${amountOfGems}, I'll restock soon!`
                      );
                    }
                    return null;
                  });
                  return null;
                }
                client.chatMessage(
                  SENDER,
                  'Make sure you do not have any Trade Holds.'
                );
                return null;
              });
              return null;
            }
            client.chatMessage(
              SENDER,
              `You can only Sell up to ${CONFIG.Restrictions.MaxSell} TF2 Keys to me at a time!`
            );
          } else {
            client.chatMessage(
              SENDER,
              'Please provide a valid amount of Keys -> !SellTF [Number of Keys]'
            );
          }
        } else if (MSG.toUpperCase().startsWith('!BUYTF')) {
          // Command: Buy TF2 Keys for Gems
          const n = MSG.toUpperCase().replace('!BUYTF ', '').trim();
          const amountOfGems = parseInt(n, 10) * CONFIG.Rates.BUY.Gems_To_TF2_Rate;
          const MyKeys = [];
          // Check if n is a positive number (using Number.isInteger for robustness)
          if (Number.isInteger(Number(n)) && Number(n) > 0) {
            if (Number(n) <= CONFIG.Restrictions.MaxBuy) {
              const t = manager.createOffer(steamID64);
              // Renamed 'error' to 'errDetails' to avoid shadowing.
              t.getUserDetails((errDetails, ME, THEM) => {
                if (errDetails) {
                  logError(`## An error occurred while getting trade holds: ${errDetails}`);
                  client.chatMessage(
                    SENDER,
                    'An error occurred while getting your trade holds. Please Enable your Steam Guard!'
                  );
                  return null;
                }
                if (ME.escrowDays === 0 && THEM.escrowDays === 0) {
                  client.chatMessage(
                    SENDER,
                    `You Requested To Buy My ${n} TF2 Keys for your ${amountOfGems} Gems`
                  );
                  // Trade preparation and sending logic
                  sleep(1500);
                  client.chatMessage(SENDER, 'Trade Processing');
                  sleep(1500);
                  client.chatMessage(SENDER, 'Please hold...');
                  sleep(1500);
                  // Renamed 'callbackError' to 'errInvUser' to avoid shadowing.
                  manager.getUserInventoryContents(
                    steamID64,
                    753,
                    6,
                    true,
                    (errInvUser, INV) => {
                      if (errInvUser) {
                        logError(errInvUser);
                        client.chatMessage(
                          SENDER,
                          "I can't load your Steam Inventory. Is it private? \r\n If it's not private, then please try again in a few seconds."
                        );
                        return null;
                      }
                      const TheirGems = INV.filter((gem) => gem.name === 'Gems');
                      if (TheirGems.length === 0) { // Checking length is safer
                        // User has 0 gems
                        client.chatMessage(
                          SENDER,
                          `You don't have enough Gems to make this trade: 0 / ${amountOfGems}`
                        );
                        return null;
                      }
                      const gem = TheirGems[0];
                      const gemDifference = amountOfGems - gem.amount;
                      if (gemDifference <= 0) {
                        // Add required gems from user to their side
                        gem.amount = amountOfGems;
                        t.addTheirItem(gem);

                        // Add bot's TF2 keys to its side
                        // Renamed 'error2' to 'errInvBot' to avoid shadowing.
                        manager.getInventoryContents(
                          440,
                          2,
                          true,
                          (errInvBot, MyInv) => {
                            if (errInvBot) {
                              logError(errInvBot);
                              return null;
                            }

                            // Replaced i = i + 1 with i += 1
                            for (let i = 0; i < MyInv.length; i += 1) {
                              if (
                                MyKeys.length < Number(n) &&
                                CONFIG.TF2_Keys.includes(MyInv[i].market_hash_name) // Used .includes()
                              ) {
                                MyKeys.push(MyInv[i]);
                              }
                            }
                            // Using Number(n) for strict comparison
                            if (MyKeys.length !== Number(n)) {
                              // Not enough keys from bot
                              if (MyKeys.length > 0) {
                                client.chatMessage(
                                  SENDER,
                                  `Sorry, I don't have enough TF2 keys to make this trade: ${MyKeys.length} / ${n}\r\nTip: Try using !BuyTF ${MyKeys.length}`
                                );
                              } else {
                                client.chatMessage(
                                  SENDER,
                                  `Sorry, I don't have enough TF2 keys to make this trade: ${MyKeys.length} / ${n}, I'll restock soon!`
                                );
                              }
                              return null;
                            }
                            // Finalize and send trade offer
                            t.addMyItems(MyKeys);
                            t.setMessage('Enjoy your TF2 Keys :)');
                            // Renamed 'sendError' to 'errSend' to avoid shadowing.
                            t.send((errSend) => {
                              if (errSend) {
                                client.chatMessage(
                                  SENDER,
                                  'Inventory refresh in session. Try again shortly please.'
                                );
                                logError(
                                  `## An error occurred while sending trade: ${errSend}`
                                );
                              } else {
                                log('[!BuyTF] Trade Offer Sent!');
                              }
                              return null;
                            });
                            return null;
                          }
                        );
                        return null;
                      }
                      // Not enough gems (with suggestion for partial trade)
                      if (
                        Math.floor(
                          gem.amount / CONFIG.Rates.BUY.Gems_To_TF2_Rate
                        ) > 0
                      ) {
                        client.chatMessage(
                          SENDER,
                          `You don't have enough Gems to make this trade: ${
                          gem.amount
                          } / ${amountOfGems}\r\nTip: Try using !BuyTF ${Math.floor(
                            gem.amount / CONFIG.Rates.BUY.Gems_To_TF2_Rate
                          )}`
                        );
                      } else {
                        client.chatMessage(
                          SENDER,
                          `You don't have enough Gems to make this trade: ${gem.amount} / ${amountOfGems}`
                        );
                      }
                      return null;
                    }
                  );
                  return null;
                }
                client.chatMessage(
                  SENDER,
                  'Make sure you do not have any Trade Holds.'
                );
                return null;
              });
              return null;
            }
            client.chatMessage(
              SENDER,
              `You can only buy up to ${CONFIG.Restrictions.MaxBuy} TF2 Keys From me at a time!`
            );
          } else {
            client.chatMessage(
              SENDER,
              'Please provide a valid amount of Keys -> !BuyTF [Number of Keys]'
            );
          }
        }
        return null;
      });
    }
    return null;
  });
}