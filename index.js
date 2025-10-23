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

  // Custom logging function (kept for debug/info messages)
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

  // Helper functions (placeholders)
  async function RefreshInventory() {
    // Logic to refresh inventory details
  }
  function Comment_User(user) {
    // Logic to post a comment on user's profile
  }
  async function Sell_Bgs_And_Emotes(offer) {
    // Logic for selling the bot's Backgrounds/Emotes for Gems
  }
  async function Buy_Bgs_And_Emotes(offer) {
    // Logic for buying user's Backgrounds/Emotes for Gems
  }
  
  // Converts unwanted items to gems based on the Convert_To_Gems config
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

        // Throttle request rate
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
        
        // Decline all other item-to-item trades
        return offer.decline((errDecline) => {
          if (errDecline) {
            logError(
              `[${getTime()}] Error declining the trade offer : ${errDecline}`,
            );
            return; 
          }
          log(`[${getTime()}] [Declined Offer] | ${PartnerID}`); 
        });
      }
      
      // Ignore offers from users on the ignore list
      if (CONFIG.Ignore_Msgs.indexOf(PartnerID) >= 0) {
        return; 
      }
      
      // Decline all other offers (empty, invalid, etc.)
      return offer.decline((errDecline) => {
        if (errDecline) {
          logError(
            `[${getTime()}] Error declining the trade offer : ${errDecline}`,
          );
          return; 
        }
        log(`[${getTime()}] [Declined Offer] | ${PartnerID}`); 
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

  // Handle successful web session (required for trading and community actions)
  client.on('webSession', async (sessionID, cookies) => {
    // Set Cookies for manager and community
    manager.setCookies(cookies);
    community.setCookies(cookies);

    // Start confirmation checker for trade confirmations
    community.startConfirmationChecker(15000, CONFIG.IDENTITYSECRET);

    // Initial item conversion check
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

    // Update 'playing' message with current gem count
    manager.getInventoryContents(753, 6, true, (error, INV) => { 
      if (error) {
        logError(`[${getTime()}] [ERROR] Could not load inventory: ${error}`); 
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
    community.getSteamUser(SENDER, (error, user) => { 
      if (error) {
        return logError(
          `[${getTime()}] Error checking current friend relationship with new customer : ${error}`,
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
    if (CONFIG.Ignore_Msgs.indexOf(SENDER.getSteamID64()) < 0) {
      community.getSteamUser(SENDER, (error, user) => { 
        if (error) {
          return logError(
            `[${getTime()}] Failure parsing users Steam Info. Possibly illegal ASCII letters in name OR steam failed to : ${error}`,
          );
        }
        log(
          `[${getTime()}] [Incoming Chat Message] ${
          user.name
          } > ${SENDER.getSteamID64()} : ${MSG}`,
        );
        
        // Spam counter update
        if (userMsgs[SENDER.getSteamID64()]) {
          userMsgs[SENDER.getSteamID64()] = userMsgs[SENDER.getSteamID64()] + 1; 
        } else {
          userMsgs[SENDER.getSteamID64()] = 1;
        }
        
        // --- Commands ---
        
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
          
          // Check TF2 inventory for keys
          manager.getUserInventoryContents(
            SENDER.getSteamID64(),
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
              
              // Check Gems inventory
              manager.getUserInventoryContents(
                SENDER.getSteamID64(),
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
                  
                  // Suggest selling TF2 keys for gems
                  if (theirTF2 > 0) {
                    tf2Msg = `- I can give you ${ 
                      theirTF2 * CONFIG.Rates.SELL.TF2_To_Gems
                      } Gems for them (Use !SellTF ${theirTF2})`;
                  }
                  
                  // Suggest buying TF2 keys with gems
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
          // Command: Sell TF2 Keys for Gems
          const n = MSG.toUpperCase().replace('!SELLTF ', '');
          const amountOfGems = parseInt(n, 10) * CONFIG.Rates.SELL.TF2_To_Gems;
          const TheirKeys = [];
          if (!Number.isNaN(Number(n)) && parseInt(n, 10) > 0) { 
            if (n <= CONFIG.Restrictions.MaxSell) {
              const t = manager.createOffer(SENDER.getSteamID64());
              t.getUserDetails((error, ME, THEM) => { 
                if (error) {
                  logError(
                    `## An error occurred while getting trade holds : ${error}`,
                  );
                  client.chatMessage(
                    SENDER,
                    'An error occurred while getting your trade holds. Please Enable your Steam Guard!',
                  );
                  return; 
                }
                if (ME.escrowDays === 0 && THEM.escrowDays === 0) { 
                  client.chatMessage(
                    SENDER,
                    `You Requested To Sell Your ${n} TF2 Keys for My ${amountOfGems} Gems`, 
                  );
                  // Trade preparation and sending logic
                  sleep(1500);
                  client.chatMessage(SENDER, 'Trade Processing');
                  sleep(1500);
                  client.chatMessage(SENDER, 'Please hold...');
                  sleep(1500);
                  manager.getInventoryContents(753, 6, true, (callbackError, MyInv) => { 
                    if (callbackError) {
                      client.chatMessage(
                        SENDER,
                        'Inventory refresh in session. Try again shortly please.',
                      );
                      return logError(`[${getTime()}] ${callbackError}`); 
                    }
                    const MyGems = MyInv.filter((gem) => gem.name === 'Gems'); 
                    if (MyGems === undefined || MyGems.length === 0) {
                      // Not enough gems
                      client.chatMessage(
                        SENDER,
                        `Sorry, I don't have enough Gems to make this trade: 0 / ${amountOfGems}, I'll restock soon!`, 
                      );
                      return; 
                    }
                    const gem = MyGems[0];
                    const gemDifference = amountOfGems - gem.amount; 
                    if (gemDifference <= 0) {
                      // Add gems to bot's side
                      gem.amount = amountOfGems; 
                      t.addMyItem(gem);
                      
                      // Add user's TF2 keys to their side
                      manager.getUserInventoryContents(
                        SENDER.getSteamID64(),
                        440,
                        2,
                        true,
                        (error2, Inv) => { 
                          if (error2) {
                            return logError(error2); 
                          }
                          
                          for (let i = 0; i < Inv.length; i = i + 1) { 
                            if (
                              TheirKeys.length < n
                              && CONFIG.TF2_Keys.indexOf(
                                Inv[i].market_hash_name,
                              ) >= 0
                            ) {
                              TheirKeys.push(Inv[i]);
                            }
                          }
                          if (TheirKeys.length !== parseInt(n, 10)) { 
                            // Not enough keys from user
                            if (TheirKeys.length > 0) {
                              client.chatMessage(
                                SENDER,
                                `You don't have enough TF2 keys to make this trade: ${TheirKeys.length} / ${n}\r\n Tip: Try using !SellTF ${TheirKeys.length}`,
                              );
                            } else {
                              client.chatMessage(
                                SENDER,
                                `You don't have enough TF2 keys to make this trade: ${TheirKeys.length} / ${n}`,
                              );
                            }
                            return null; 
                          }
                          // Finalize and send trade offer
                          t.addTheirItems(TheirKeys);
                          t.setMessage('Your Gems Are Ready! Enjoy :)');
                          t.send((sendError) => { 
                            if (sendError) {
                              client.chatMessage(
                                SENDER,
                                'Inventory refresh in session. Try again shortly please.',
                              );
                              logError(
                                `## An error occurred while sending trade: ${sendError}`,
                              );
                            } else {
                              log(
                                `[${getTime()}] [!SellTF] Trade Offer Sent!`,
                              );
                            }
                            return null; 
                          });
                          return null; 
                        },
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
                          gem.amount / CONFIG.Rates.SELL.TF2_To_Gems,
                        )}`,
                      );
                    } else {
                      client.chatMessage(
                        SENDER,
                        `Sorry, I don't have enough Gems to make this trade: ${gem.amount} / ${amountOfGems}, I'll restock soon!`, 
                      );
                    }
                    return null; 
                  });
                  return null; 
                }
                client.chatMessage(
                  SENDER,
                  'Make sure you do not have any Trade Holds.',
                );
                return null; 
              });
              return null; 
            }
            client.chatMessage(
              SENDER,
              `You can only Sell up to ${CONFIG.Restrictions.MaxSell} TF2 Keys to me at a time!`,
            );
          } else {
            client.chatMessage(
              SENDER,
              'Please provide a valid amount of Keys -> !SellTF [Number of Keys]',
            );
          }
        } else if (MSG.toUpperCase().indexOf('!BUYTF') >= 0) {
          // Command: Buy TF2 Keys for Gems
          const n = MSG.toUpperCase().replace('!BUYTF ', '');
          const amountOfGems = parseInt(n, 10) * CONFIG.Rates.BUY.Gems_To_TF2_Rate; 
          const MyKeys = [];
          if (!Number.isNaN(Number(n)) && parseInt(n, 10) > 0) { 
            if (n <= CONFIG.Restrictions.MaxBuy) {
              const t = manager.createOffer(SENDER.getSteamID64());
              t.getUserDetails((error, ME, THEM) => { 
                if (error) {
                  logError(
                    `## An error occurred while getting trade holds: ${error}`,
                  );
                  client.chatMessage(
                    SENDER,
                    'An error occurred while getting your trade holds. Please Enable your Steam Guard!',
                  );
                  return; 
                }
                if (ME.escrowDays === 0 && THEM.escrowDays === 0) { 
                  client.chatMessage(
                    SENDER,
                    `You Requested To Buy My ${n} TF2 Keys for your ${amountOfGems} Gems`, 
                  );
                  // Trade preparation and sending logic
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
                    (callbackError, INV) => { 
                      if (callbackError) {
                        logError(`[${getTime()}] ${callbackError}`); 
                        client.chatMessage(
                          SENDER,
                          "I can't load your Steam Inventory. Is it private? \r\n If it's not private, then please try again in a few seconds.",
                        );
                        return; 
                      }
                      const TheirGems = INV.filter((gem) => gem.name === 'Gems'); 
                      if (typeof TheirGems[0] === 'undefined') {
                        // User has 0 gems
                        client.chatMessage(
                          SENDER,
                          `You don't have enough Gems to make this trade: 0 / ${amountOfGems}`, 
                        );
                        return; 
                      }
                      const gem = TheirGems[0];
                      const gemDifference = amountOfGems - gem.amount; 
                      if (gemDifference <= 0) {
                        // Add required gems from user to their side
                        gem.amount = amountOfGems; 
                        t.addTheirItem(gem);
                        
                        // Add bot's TF2 keys to its side
                        manager.getInventoryContents(
                          440,
                          2,
                          true,
                          (error2, MyInv) => { 
                            if (error2) {
                              return logError(error2); 
                            }
                            
                            for (let i = 0; i < MyInv.length; i = i + 1) { 
                              if (
                                MyKeys.length < parseInt(n, 10) 
                                && CONFIG.TF2_Keys.indexOf(
                                  MyInv[i].market_hash_name,
                                ) >= 0
                              ) {
                                MyKeys.push(MyInv[i]);
                              }
                            }
                            if (MyKeys.length !== parseInt(n, 10)) { 
                              // Not enough keys from bot
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
                              return null; 
                            }
                            // Finalize and send trade offer
                            t.addMyItems(MyKeys);
                            t.setMessage('Enjoy your TF2 Keys :)');
                            t.send((sendError) => { 
                              if (sendError) {
                                client.chatMessage(
                                  SENDER,
                                  'Inventory refresh in session. Try again shortly please.',
                                );
                                logError(
                                  `## An error occurred while sending trade: ${sendError}`,
                                );
                              } else {
                                log(
                                  `[${getTime()}] [!BuyTF] Trade Offer Sent!`,
                                );
                              }
                              return null; 
                            });
                            return null; 
                          },
                        );
                        return null; 
                      }
                      // Not enough gems (with suggestion for partial trade)
                      if (
                        Math.floor( 
                          gem.amount / CONFIG.Rates.BUY.Gems_To_TF2_Rate,
                        ) > 0
                      ) {
                        client.chatMessage(
                          SENDER,
                          `You don't have enough Gems to make this trade: ${
                          gem.amount
                          } / ${amountOfGems}\r\nTip: Try using !BuyTF ${Math.floor( 
                            gem.amount / CONFIG.Rates.BUY.Gems_To_TF2_Rate,
                          )}`,
                        );
                      } else {
                        client.chatMessage(
                          SENDER,
                          `You don't have enough Gems to make this trade: ${gem.amount} / ${amountOfGems}`, 
                        );
                      }
                      return null; 
                    },
                  );
                  return null; 
                }
                client.chatMessage(
                  SENDER,
                  'Make sure you do not have any Trade Holds.',
                );
                return null; 
              });
              return null; 
            }
            client.chatMessage(
              SENDER,
              `You can only buy up to ${CONFIG.Restrictions.MaxBuy} TF2 Keys From me at a time!`,
            );
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
}