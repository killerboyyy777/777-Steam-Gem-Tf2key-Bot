// -------------------------------------------------------------
// Modified Version of Steam-Gem-Key-Bot
// Original Author: mfw (https://steamcommunity.com/id/mfwBan)
// Original License: GNU General Public License v3.0 (GPLv3)
//
// Modifications and maintenance by killerboyyy777 (https://steamcommunity.com/id/klb777)
// Changes include:
//    - Enhanced API communication
//    - Implemented AutoGem weekly conversion feature
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
const CONFIG = require('./SETTINGS/config'); // Fixed: import/extensions

// Cluster setup for process resilience
if (cluster.isMaster) {
  cluster.fork();

  cluster.on('exit', () => {
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
    console.log(`[${getTime()}]`, ...args);
  }

  function logError(...args) {
    // eslint-disable-next-line no-console
    console.error(`[${getTime()}] [ERROR]`, ...args);
  }

  // Get current time for log timestamps
  function getTime() {
    const time = new Date();
    const hours = String(time.getHours()).padStart(2, '0');
    const minutes = String(time.getMinutes()).padStart(2, '0');
    const seconds = String(time.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  // Initial console cleanup and header (DEBUG/LICENSE)
  function logBanner() {
    // eslint-disable-next-line no-console
    console.clear();
    // eslint-disable-next-line no-console
    console.log('\x1b[32m///////////////////////////////////////////////////////////////////////////\x1b[0m');
    // eslint-disable-next-line no-console
    console.log('\x1b[31mCopyright (C) 2025 killerboyyy777\x1b[0m');
    // eslint-disable-next-line no-console
    console.log('\x1b[31mhttps://steamcommunity.com/id/klb777\x1b[0m');
    // eslint-disable-next-line no-console
    console.log('\x1b[32m///////////////////////////////////////////////////////////////////////////\x1b[0m');
  }

  // Initialize Profit JSON if it doesn't exist
  function InitJSON() {
    if (fs.existsSync('./SETTINGS/TotalSold.json')) {
      return; // File already exists
    }

    log(`[Init] TotalSold.json not found. Creating a new one...`);

    const defaultStructure = {
      Profit: {
        Buy: {
          TF2: [0, 0, 0], // [Lifetime, Weekly, Daily] - Profit from !BuyTF
          CRAP: [0, 0, 0], // [Lifetime, Weekly, Daily] - Profit from buying BGs/Emotes
        },
        Sell: {
          TF2: [0, 0, 0], // [Lifetime, Weekly, Daily] - Profit from !SellTF
          CRAP: [0, 0, 0], // [Lifetime, Weekly, Daily] - Profit from selling BGs/Emotes
        },
      },
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
      logError(`[Init] FATAL ERROR: Could not create TotalSold.json: ${err.message}`);
      process.exit(1); // Exit worker if we can't write the profit file
    }
  }

  // Post comment on user's profile
  function CommentUser(steamID) {
    if (!CONFIG.Comment_After_Trade) {
      return; // Do nothing if config is empty
    }
    community.getSteamUser(steamID, (err, user) => {
      if (err) {
        logError(
          `## An error occurred while getting user profile: Usually private. ${err}`,
        );
        return;
      }

      user.comment(CONFIG.Comment_After_Trade, (err) => {
        if (err) {
          logError(
            `## An error occurred while commenting on user profile: comments disabled for any reason. ${err}`,
          );
        }
      });
    });
  }

  // Function to refresh inventory and update playing status
  function RefreshInventory() {
    manager.getInventoryContents(753, 6, true, (err, inv) => {
      if (err) {
        logError(`Error Refreshing Inventory : ${err}`);
      } else {
        let myGems = 0;
        const myGemsArray = inv.filter((gem) => gem.name === 'Gems');
        if (typeof myGemsArray[0] !== 'undefined') {
          const gem = myGemsArray[0];
          myGems = gem.amount;
        }
        const playThis = `${myGems} Gems > Buy/Sell Gems (!prices)`;
        client.gamesPlayed(playThis, true);
      }
    });
  }

  // Converts unwanted items to gems
  async function autoGemItems() {
    try {
      log(`[AutoGem] Checking inventory for items to convert...`);

      const sessionID = community.getSessionID();
      if (!sessionID) {
        log(`[AutoGem] No valid session ID yet, skipping.`);
        return;
      }

      // Fetch user inventory (App ID 753, Context ID 6 for Steam Community)
      const inventory = await new Promise((resolve, reject) => {
        community.getUserInventoryContents(client.steamID, 753, 6, true, (err, inv) => {
          if (err) return reject(err);
          resolve(inv || []);
          return null; // Added return to satisfy linter
        });
      });

      if (inventory.length === 0) {
        log(`[AutoGem] Inventory empty or unavailable.`);
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

        log(`[AutoGem] Converting ${item.market_hash_name} (${gemValue} gems)...`);
        gemmedCount += 1;

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
                  `[AutoGem] Error converting ${item.market_hash_name}: ${err || res.statusCode}`
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

      log(`[AutoGem] Finished converting ${gemmedCount} items this run.`);
    } catch (err) {
      logError(`[AutoGem] Error:`, err.message);
    }
  }

  // Sell BGs/Emotes logic
  function SellBgsAndEmotes(offer) {
    const partnerID = offer.partner.getSteamID64();
    const myItems = offer.itemsToGive;
    const theirItems = offer.itemsToReceive;
    let myBgAndEmote = 0;
    let priceInGems = 0;

    for (let i = 0; i < myItems.length; i += 1) {
      const myItem = myItems[i];
      const tag = myItem.type;
      if (tag.includes('Profile Background') || tag.includes('Emoticon')) {
        if (!CONFIG.Restrictions.ItemsNotForTrade.includes(myItem.name)) {
          myBgAndEmote += 1;
        }
      }
    }
    priceInGems = myBgAndEmote * CONFIG.Rates.SELL.BG_And_Emotes;

    if (offer.itemsToGive.length === myBgAndEmote && myBgAndEmote > 0) {
      const theirGems = theirItems.filter((gem) => gem.name === 'Gems');
      if (typeof theirGems[0] === 'undefined') {
        offer.decline((err) => {
          if (err) {
            logError(`Error declining offer: ${err}`);
          }
        });
        return;
      }
      
      const gem = theirGems[0];
      if (gem.amount >= priceInGems) {
        const database = JSON.parse(
          fs.readFileSync('./SETTINGS/TotalSold.json').toString('utf8'),
        );
        // Profit = (Gems received) - (Gems paid for them, if we bought them)
        const profit = (myItems.length * CONFIG.Rates.SELL.BG_And_Emotes) - (myItems.length * CONFIG.Rates.BUY.BG_And_Emotes);
        database.Profit.Sell.CRAP[0] += profit;
        database.Profit.Sell.CRAP[1] += profit;
        database.Profit.Sell.CRAP[2] += profit;
        fs.writeFileSync(
          './SETTINGS/TotalSold.json',
          JSON.stringify(database, undefined, '\t'),
        );
        offer.accept((err) => {
          if (err) {
            logError(
              `Error accepting trade during selling your BG's Emotes : ${err}`,
            );
            return;
          }
          client.chatMessage(
            partnerID,
            'Trade Complete! Enjoy and please +Rep my profile to let others know I work!',
          );
          RefreshInventory();
          client.chatMessage(
            CONFIG.Owner[0],
            `Trade Accepted From : ${partnerID} - They bought your BGs/Emotes`,
          );
          log(
            `Trade Accepted From : ${partnerID} - Bought your BGs/Emotes`,
          );
          CommentUser(offer.partner);
        });
      } else {
        // Not enough gems,decline
        client.chatMessage(
          partnerID,
          `Rates are incorrect.You offered ${gem.amount} Gems but this trade requires ${priceInGems} Gems (${myItems.length} item(s) × ${CONFIG.Rates.SELL.BG_And_Emotes} Gems each). Please retry using the correct rates.`,
        );
        offer.decline((err) => {
          if (err) {
            logError(`Error SELLING bgs/emotes : ${err}`);
          }
        });
      }
    } else {
      client.chatMessage(
        partnerID,
        'Sorry, One or more of the Items are not for sale or you did not add any valid items. Try again please with other items!',
      );
      offer.decline((err) => {
        log(
          `[SellBG] Declined! ${partnerID} - They tried to buy something blacklisted or invalid!`,
        );
        if (err) {
          logError(`Error declining: ${err}`);
        }
      });
    }
    return null; // Consistent return for SellBgsAndEmotes
  }

  // Buy BGs/Emotes logic
  function BuyBgsAndEmotes(offer) {
    const partnerID = offer.partner.getSteamID64();
    const myItems = offer.itemsToGive;
    const theirItems = offer.itemsToReceive;
    let theirBgAndEmote = 0;
    let priceInGems = 0;

    for (let i = 0; i < theirItems.length; i += 1) {
      const theirItem = theirItems[i];
      const tag = theirItem.type;
      if (tag.includes('Profile Background') || tag.includes('Emoticon')) {
        if (!CONFIG.Restrictions.ItemsNotForTrade.includes(theirItem.name)) {
          theirBgAndEmote += 1;
        }
      }
    }
    priceInGems = theirBgAndEmote * CONFIG.Rates.BUY.BG_And_Emotes;

    // Check if they only added valid BGs/Emotes and nothing else
    if (offer.itemsToReceive.length === theirBgAndEmote && theirBgAndEmote > 0) {
      const myGems = myItems.filter((gem) => gem.name === 'Gems');
      if (typeof myGems[0] === 'undefined' || offer.itemsToGive.length > 1) {
        client.chatMessage(
          partnerID,
          'Trade Validation Failed. You can only take Gems for your BGs/Emotes.',
        );
        offer.decline((err) => {
          if (err) {
            logError(
              `Error declining trade, Likely steam : ${err}`,
            );
          }
        });
        return;
      }

      const gem = myGems[0];
      if (gem.amount <= priceInGems) {
        const database = JSON.parse(
          fs.readFileSync('./SETTINGS/TotalSold.json').toString('utf8'),
        );
        // Profit = (What bot will sell for) - (What bot paid)
        const profit = (theirItems.length * CONFIG.Rates.SELL.BG_And_Emotes) - (theirItems.length * CONFIG.Rates.BUY.BG_And_Emotes);
        database.Profit.Buy.CRAP[0] += profit;
        database.Profit.Buy.CRAP[1] += profit;
        database.Profit.Buy.CRAP[2] += profit;
        fs.writeFileSync(
          './SETTINGS/TotalSold.json',
          JSON.stringify(database, undefined, '\t'),
        );
        offer.accept((err) => {
          if (err) {
            logError(
              `Error accepting trade while buying their bgs/emotes : ${err}`,
            );
            return;
          }
          client.chatMessage(
            partnerID,
            'Trade Complete! Enjoy and please +Rep my profile to let others know I work!',
          );
          RefreshInventory();
          client.chatMessage(
            CONFIG.Owner[0],
            `Trade Accepted From : ${partnerID} - They sold you BGs/Emotes`,
          );
          log(
            `Trade Accepted From : ${partnerID} - Sold you BGs/Emotes`,
          );
          CommentUser(offer.partner);
        });
      } else {
        client.chatMessage(
          partnerID,
          `You are trying to take too many Gems. This trade requires ${priceInGems} Gems, but you tried to take ${gem.amount}. Please try again.`,
        );
        offer.decline((err) => {
          if (err) {
            logError(`Error BUYING bgs/emotes (too many gems): ${err}`);
          }
        });
      }
    } else {
      client.chatMessage(
        partnerID,
        'Trade Validation Failed. You can only trade Backgrounds/Emotes for Gems. Make sure you are not trading non-gemmable items or items from the "ItemsNotForTrade" list.',
      );
      offer.decline((err) => {
        log(
          `[BuyBG] Declined! - ${partnerID} : Tried to sell non-BG/Emote items.`,
        );
        if (err) {
          logError(`Error declining: ${err}`);
        }
      });
    }
    return null; // Consistent return for BuyBgsAndEmotes
  }

  // Processes incoming trade offers
  function ProccessTradeOffer(offer) {
    const partnerID = offer.partner.getSteamID64();
    offer.getUserDetails((error) => {
      if (error) {
        logError(
          `An error occured while processing a trade : ${error}`,
        );
        return;
      }

      // Auto-accept admin trades
      if (CONFIG.Owner.indexOf(partnerID) >= 0) {
        offer.accept((errAccept) => {
          if (errAccept) {
            logError(
              `Error occured while auto accepting admin trades : ${errAccept}`,
            );
            return;
          }
          log(`[Accepted Offer] | ${partnerID}`);
          return;
        });
        return;
      }

      // Auto-accept donations
      if (offer.itemsToGive.length === 0) {
        offer.accept((errAccept) => {
          if (errAccept) {
            logError(
              `Error occured accepting donations : ${errAccept}`,
            );
            return;
          }
          log(`[Donation Accepted] | ${partnerID}`);
          client.chatMessage(partnerID, 'Your donation is appreciated!');
          return;
        });
        return;
      }

      // Logic for item-based trades
      if (offer.itemsToReceive.length > 0) {
        const myItems = offer.itemsToGive;
        // Check for empty array just in case
        if (myItems.length === 0) {
          offer.decline();
          return;
        }
        const tag = myItems[0].type;
        const theirItems = offer.itemsToReceive;
        const tag2 = theirItems[0].type;

        // Selling the bot's BGs/Emotes for the user's Gems
        if (tag.includes('Profile Background') || tag.includes('Emoticon')) {
          SellBgsAndEmotes(offer);
          return;
        }

        // Buying the user's BGs/Emotes for the bot's Gems
        if (
          tag2.includes('Profile Background') || tag2.includes('Emoticon')
        ) {
          BuyBgsAndEmotes(offer);
          return;
        }
      }

      // Ignore offers from users on the ignore list
      if (CONFIG.Ignore_Msgs.indexOf(partnerID) >= 0) {
        log(`[Ignored Offer] | ${partnerID} is on ignore list.`);
        return;
      }

      // Decline all other offers (empty, invalid, non-BG/Emote item trades)
      offer.decline((errDecline) => {
        if (errDecline) {
          logError(
            `Error declining the trade offer : ${errDecline}`,
          );
          return;
        }
        log(`[Declined Offer] (Invalid Items) | ${partnerID}`);
        return;
      });
      return null;
    });
    return null;
  }

  // --- Start of Worker Logic ---

  logBanner();

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
        log(`Successfully Logged Into Your Bot Account`);
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

    log(`[AutoGem] Starting initial AutoGem check...`);
    await autoGemItems();

    // Repeat Autogem once per Week
    setInterval(() => {
      log(`[AutoGem] Running weekly AutoGem check...`);
      autoGemItems();
    }, 7 * 24 * 60 * 60 * 1000); // 1 Week interval

    // Accept pending friend requests
    for (let i = 0; i < Object.keys(client.myFriends).length; i += 1) {
      if (client.myFriends[Object.keys(client.myFriends)[i]] === 2) {
        client.addFriend(Object.keys(client.myFriends)[i]);
      }
    }

    // Update 'playing' message
    RefreshInventory();
  });

  // Handle new friend requests
  client.on('friendRelationship', (sender, rel) => {
    community.getSteamUser(sender, (error, user) => {
      if (error) {
        logError(
          `Error checking current friend relationship: ${error}`,
        );
        return null;
      }
      if (rel === 2) { // New friend request
        log(
          `[New Friend] - ${user.name} > ${sender.getSteamID64()} - SteamID`,
        );
        client.addFriend(sender);
      } else if (rel === 3) { // Friend accepted
        if (CONFIG.INVITETOGROUPID) {
          client.inviteToGroup(sender, CONFIG.INVITETOGROUPID);
          client.chatMessage(sender, CONFIG.MESSAGES.WELCOME);
        }
      }
      return null;
    });
  });

  // Handle session expiration
  community.on('sessionExpired', (error) => {
    if (!error) {
      log(`Session Expired. Relogging.`);
      client.webLogOn();
    }
  });

  // Handle new mobile trade confirmations
  community.on('newConfirmation', (conf) => {
    log('## New confirmation.');
    community.acceptConfirmationForObject(
      CONFIG.IDENTITYSECRET,
      conf.id,
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
      if (error) return logError(error);
      log(
        `[New Trade Offer] From: ${offer.partner.getSteamID64()}`,
      );
      ProccessTradeOffer(offer);
      return null;
    });
  });

  // Spam Filter: checks for message spam every second
  setInterval(() => {
    for (let i = 0; i < Object.keys(userMsgs).length; i += 1) {
      if (userMsgs[Object.keys(userMsgs)[i]] > CONFIG.MAXMSGPERSEC) {
        client.chatMessage(
          Object.keys(userMsgs)[i],
          "Sorry but we do not like spamming. You've been removed!",
        );
        client.removeFriend(Object.keys(userMsgs)[i]);
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

  // Handle chat messages and commands
  client.on('friendMessage', (sender, msg) => {
    const steamID64 = sender.getSteamID64();

    if (CONFIG.Ignore_Msgs.indexOf(steamID64) < 0) {
      community.getSteamUser(sender, (error, user) => {
        if (error) {
          logError(
            `Failure parsing users Steam Info: ${error}`,
          );
          return null;
        }
        log(
          `[Incoming Chat Message] ${
            user.name
          } > ${steamID64} : ${msg}`,
        );

        // Spam counter update
        if (userMsgs[steamID64]) {
          userMsgs[steamID64] += 1;
        } else {
          userMsgs[steamID64] = 1;
        }

        // --- Admin Commands ---
        if (CONFIG.Owner.indexOf(steamID64) >= 0) {
          const upperMsg = msg.toUpperCase();

          if (upperMsg === '!ADMIN') {
            client.chatMessage(sender, CONFIG.MESSAGES.ADMINHELP);
            return null;
          }

          if (upperMsg === '!PROFIT') {
            // Profit command
            try {
              const database = JSON.parse(
                fs.readFileSync('./SETTINGS/TotalSold.json').toString('utf8'),
              );
              const bought = database.Profit.Buy;
              const sold = database.Profit.Sell;

              // Calculate totals
              const totalBoughtDaily = bought.TF2[1] + bought.CRAP[1];
              const totalSoldDaily = sold.TF2[1] + sold.CRAP[1];
              const totalBoughtLifetime = bought.TF2[0] + bought.CRAP[0];
              const totalSoldLifetime = sold.TF2[0] + sold.CRAP[0];

              let content = "-------------------------------\r\nYour Bot's Activity Today:\r\n\r\n";
              content += `- Profited ${totalBoughtDaily} Gems from Buy Features\r\n- Profited ${totalSoldDaily} Gems from Sell Features\r\n\r\nActivity since the start:\r\n\r\n- Profited ${totalBoughtLifetime} Gems from Buy Features\r\n- Profited ${totalSoldLifetime} Gems from Sell Features\r\n-------------------------------\r\n\r\n ↧↧↧\r\n\r\n[Buy Features Activity Today ★] \r\n-------------------------------\r\n✔ ${bought.TF2[1]} Gems Profit ► !BuyTF  |  ( ► Lifetime Profit: ${bought.TF2[0]} Gems)\r\n✔ ${bought.CRAP[1]} Gems Profit ► (BG/Emote Trades)  |  ( ► Lifetime Profit: ${bought.CRAP[0]} Gems)`;
              content += '\r\n\r\n\r\n';
              content += `[Sell Commands Activity Today ★]\r\n-------------------------------\r\n✔ ${sold.TF2[1]} Gems Profit ► !SellTF  |  ( ► Lifetime Profit: ${sold.TF2[0]} Gems)\r\n✔ ${sold.CRAP[1]} Gems Profit ► (BG/EMOTE Trades)  |  ( ► Lifetime Profit: ${sold.CRAP[0]} Gems)\r\n\r\n`;
              client.chatMessage(sender, content);
            } catch (e) {
              logError(`[!PROFIT] Error reading TotalSold.json: ${e.message}`);
              client.chatMessage(sender, 'Error: Could not read profit file.');
            }
            return null; // Stop processing
          }

          if (upperMsg.startsWith('!BLOCK ')) {
            // Block command
            const n = upperMsg.replace('!BLOCK ', '').toString();
            if (SID64REGEX.test(n)) {
              if (CONFIG.Owner.indexOf(n) >= 0) {
                client.chatMessage(sender, 'Admins cannot be blocked.');
                return null;
              }
              client.chatMessage(sender, 'User blocked and unfriended.');
              client.removeFriend(n);
              client.blockUser(n);
              log(`[Admin] User ${n} hard-blocked by ${steamID64}.`);
            } else {
              client.chatMessage(
                sender,
                '[Error] Please provide a valid SteamID64',
              );
            }
            return null; // Stop processing
          }

          if (upperMsg.startsWith('!UNBLOCK ')) {
            // Unblock command
            const n = upperMsg.replace('!UNBLOCK ', '').toString();
            if (SID64REGEX.test(n)) {
              client.chatMessage(sender, 'User UnBlocked + Friended');
              client.unblockUser(n, (errUnblock) => { // Renamed err
                if (errUnblock) {
                  logError(`[Admin] Error unblocking ${n}: ${errUnblock.message}`);
                  client.chatMessage(sender, `Error unblocking: ${errUnblock.message}`);
                  return;
                }
                log(`[Admin] User ${n} unblocked by ${steamID64}.`);
                sleep(2000); // Wait for unblock to process
                client.addFriend(n, (errFriend, name) => {
                  if (errFriend) {
                    logError(`[Admin] Error re-adding ${n}: ${errFriend.message}`);
                    return;
                  }
                  if (name) {
                    log(`[Admin] User ${name} (${n}) friended.`);
                  }
                });
              });
            } else {
              client.chatMessage(sender, 'Please provide a valid SteamID64');
            }
            return null; // Stop processing
          }

          if (upperMsg.startsWith('!BROADCAST ')) {
            // Broadcast command
            const broadcastMsg = msg.substring(11).trim();
            if (broadcastMsg.length === 0) {
              client.chatMessage(sender, 'Please provide a message. Usage: !Broadcast [Message]');
              return null;
            }

            let friendCount = 0;
            const friendSteamIDs = Object.keys(client.myFriends);

            log(`[Admin] Starting broadcast from ${steamID64}...`);
            friendSteamIDs.forEach((friendID, index) => {
              if (client.myFriends[friendID] === 3) { // SteamUser.EFriendRelationship.Friend
                setTimeout(() => {
                  client.chatMessage(friendID, broadcastMsg);
                }, index * 500); // 500ms delay
                friendCount += 1;
              }
            });

            client.chatMessage(sender, `Broadcast sending to ${friendCount} friends.`);
            log(`[Admin] Broadcast sent to ${friendCount} friends: "${broadcastMsg}"`);
            return null; // Stop processing
          }
        } // --- End Admin Commands ---


        // --- User Commands ---

        if (msg.toUpperCase() === '!HELP') {
          client.chatMessage(sender, CONFIG.MESSAGES.HELP);
        } else if (
          msg.toUpperCase() === '!PRICE' ||
          msg.toUpperCase() === '!RATE' ||
          msg.toUpperCase() === '!RATES' ||
          msg.toUpperCase() === '!PRICES'
        ) {
          client.chatMessage(
            sender,
            `Sell Your: \r\n1 TF2 Key for Our ${CONFIG.Rates.SELL.TF2_To_Gems} Gems\r\n\r\nBuy Our: \r\n1 TF2 Key for Your ${CONFIG.Rates.BUY.Gems_To_TF2_Rate} Gems\r\n\r\nWe're also:\r\nBuying Your Backgrounds & emotes for ${CONFIG.Rates.BUY.BG_And_Emotes} Gems (Send offer & add correct number of my gems for auto accept.)\r\nSelling any of OUR Backgrounds & emotes for ${CONFIG.Rates.SELL.BG_And_Emotes} Gems (Send offer & add correct number of my gems for auto accept.)`,
          );
        } else if (msg.toUpperCase() === '!INFO') {
          client.chatMessage(
            sender,
            `Bot owned by https://steamcommunity.com/id/klb777\r\n1 Use !help to see all Commands`,
          );
        } else if (msg.toUpperCase() === '!CHECK') {
          let theirTF2 = 0;
          let theirGems;

          manager.getUserInventoryContents(
            steamID64,
            440,
            2,
            true,
            (error, inv) => {
              if (error) {
                logError(error);
                return null;
              }
              for (let i = 0; i < inv.length; i += 1) {
                if (CONFIG.TF2_Keys.indexOf(inv[i].market_hash_name) >= 0) {
                  theirTF2 += 1;
                }
              }

              manager.getUserInventoryContents(
                steamID64,
                753,
                6,
                true,
                (error3, inv3) => {
                  if (error3) {
                    logError(error3);
                    return null;
                  }
                  const theirGemsArray = inv3.filter((gem) => gem.name === 'Gems');
                  if (typeof theirGemsArray[0] === 'undefined' || theirGemsArray.length === 0) {
                    theirGems = 0;
                  } else {
                    const gem = theirGemsArray[0];
                    theirGems = gem.amount;
                  }

                  let tf2Msg = '';
                  let gemsMsg = '';

                  if (theirTF2 > 0) {
                    tf2Msg = `- I can give you ${
                      theirTF2 * CONFIG.Rates.SELL.TF2_To_Gems
                    } Gems for them (Use !SellTF ${theirTF2})`;
                  }

                  const keysToBuy = Math.floor(
                    theirGems / CONFIG.Rates.BUY.Gems_To_TF2_Rate,
                  );

                  if (keysToBuy > 0) {
                    gemsMsg = `- I can give you ${keysToBuy} TF2 Keys for Your ${
                      keysToBuy * CONFIG.Rates.BUY.Gems_To_TF2_Rate
                    } Gems (Use !BuyTF ${keysToBuy})`;
                  }

                  client.chatMessage(
                    sender,
                    `You have:\r\n\r\n${theirTF2} TF2 Keys\r\n${tf2Msg}\r\nYou have:\r\n\r\n${theirGems} Gems ${gemsMsg}`,
                  );
                  return null;
                },
              );
              return null;
            },
          );
        } else if (msg.toUpperCase().startsWith('!SELLTF')) {
          // Command: Sell TF2 Keys for Gems
          let n = msg.toUpperCase().replace('!SELLTF ', '');
          let amountOfGems = parseInt(n, 10) * CONFIG.Rates.SELL.TF2_To_Gems;
          const theirKeys = [];
          if (!Number.isNaN(parseInt(n, 10)) && parseInt(n, 10) > 0) {
            if (parseInt(n, 10) <= CONFIG.Restrictions.MaxSell || CONFIG.Restrictions.MaxSell === 0) {
              const t = manager.createOffer(sender.getSteamID64());
              t.getUserDetails((errDetails, me, them) => {
                if (errDetails) {
                  logError(
                    `## An error occurred while getting trade holds: ${errDetails}`,
                  );
                  client.chatMessage(
                    sender,
                    'An error occurred while getting your trade holds. Please Enable your Steam Guard!',
                  );
                  return null;
                }
                if (me.escrowDays === 0 && them.escrowDays === 0) {
                  n = parseInt(n, 10);
                  client.chatMessage(
                    sender,
                    `You Requested To Sell Your ${n} TF2 Keys for My ${amountOfGems} Gems`,
                  );
                  sleep(1500);
                  client.chatMessage(sender, 'Trade Processing');
                  sleep(1500);
                  client.chatMessage(sender, 'Please hold...');
                  sleep(1500);
                  manager.getInventoryContents(753, 6, true, (errInv, myInv) => {
                    if (errInv) { // Renamed 'ERR' to 'errInv'
                      client.chatMessage(
                        sender,
                        'Inventory refresh in session. Try again shortly please.',
                      );
                      logError(errInv);
                      return null;
                    }
                    const myGemsArray = myInv.filter((gem) => gem.name === 'Gems');
                    if (typeof myGemsArray[0] === 'undefined' || myGemsArray.length === 0) {
                      client.chatMessage(
                        sender,
                        `Sorry, I don't have enough Gems to make this trade: 0 / ${amountOfGems}, I'll restock soon!`,
                      );
                    } else {
                      const gem = myGemsArray[0];
                      const gemDifference = amountOfGems - gem.amount;
                      if (gemDifference <= 0) {
                        gem.amount = amountOfGems;
                        t.addMyItem(gem);
                        ///
                        manager.getUserInventoryContents(
                          sender.getSteamID64(),
                          440,
                          2,
                          true,
                          (errUserInv, inv) => { // Renamed 'ERR2' to 'errUserInv'
                            if (errUserInv) {
                              logError(errUserInv);
                              return null;
                            }
                            ///
                            for (let i = 0; i < inv.length; i += 1) {
                              if (
                                theirKeys.length < n &&
                                CONFIG.TF2_Keys.includes(inv[i].market_hash_name)
                              ) {
                                theirKeys.push(inv[i]);
                              }
                            }
                            if (theirKeys.length !== n) {
                              if (theirKeys.length > 0) {
                                client.chatMessage(
                                  sender,
                                  `You don't have enough TF2 keys to make this trade: ${theirKeys.length} / ${n}\r\nTip: Try using !SellTF ${theirKeys.length}`,
                                );
                              } else {
                                client.chatMessage(
                                  sender,
                                  `You don't have enough TF2 keys to make this trade: ${theirKeys.length} / ${n}`,
                                );
                              }
                            } else {
                              t.addTheirItems(theirKeys);
                              t.setMessage('!SellTF - Enjoy your Gems! Have a good day :)');
                              t.send((errSend) => { // Renamed 'ERR' to 'errSend'
                                if (errSend) {
                                  client.chatMessage(
                                    sender,
                                    'Inventory refresh in session. Try again shortly please.',
                                  );
                                  logError(
                                    `## An error occurred while sending trade : ${errSend}`,
                                  );
                                } else {
                                  log(
                                    `[!SellTF] Trade Offer Sent!`,
                                  );
                                }
                              });
                            }
                            return null;
                          },
                        );
                      } else if (
                        Math.floor(gem.amount / CONFIG.Rates.SELL.TF2_To_Gems) > 0
                      ) {
                        client.chatMessage(
                          sender,
                          `Sorry, I don't have enough Gems to make this trade: ${
                            gem.amount
                          } / ${amountOfGems}\r\nTip: Try using !SellTF ${Math.floor(
                            gem.amount / CONFIG.Rates.SELL.TF2_To_Gems,
                          )}`,
                        );
                      } else {
                        client.chatMessage(
                          sender,
                          `Sorry, I don't have enough Gems to make this trade: ${gem.amount} / ${amountOfGems}, I'll restock soon!`,
                        );
                      }
                    }
                    return null;
                  });
                } else {
                  client.chatMessage(
                    sender,
                    'Make sure you do not have any Trade Holds.',
                  );
                }
                return null;
              });
            } else {
              client.chatMessage(
                sender,
                `You can only Sell up to ${CONFIG.Restrictions.MaxSell} TF2 Keys to me at a time!`,
              );
            }
          } else {
            client.chatMessage(
              sender,
              'Please provide a valid amount of Keys -> !SellTF [Number of Keys]',
            );
          }
        } else if (msg.toUpperCase().startsWith('!BUYTF')) {
          // Command: Buy TF2 Keys for Gems
          const n = msg.toUpperCase().replace('!BUYTF ', '');
          const amountOfGems = parseInt(n, 10) * CONFIG.Rates.BUY.Gems_To_TF2_Rate;
          const myKeys = [];
          if (!Number.isNaN(parseInt(n, 10)) && parseInt(n, 10) > 0) {
            if (parseInt(n, 10) <= CONFIG.Restrictions.MaxBuy || CONFIG.Restrictions.MaxBuy === 0) {
              const t = manager.createOffer(sender.getSteamID64());
              t.getUserDetails((errDetails, me, them) => {
                if (errDetails) {
                  logError(
                    `## An error occurred while getting trade holds: ${errDetails}`,
                  );
                  client.chatMessage(
                    sender,
                    'An error occurred while getting your trade holds. Please Enable your Steam Guard!',
                  );
                  return null;
                }
                if (me.escrowDays === 0 && them.escrowDays === 0) {
                  client.chatMessage(
                    sender,
                    `You Requested To Buy My ${n} TF2 Keys for your ${amountOfGems} Gems`,
                  );
                  sleep(1500);
                  client.chatMessage(sender, 'Trade Processing');
                  sleep(1500);
                  client.chatMessage(sender, 'Please hold...');
                  sleep(1500);
                  manager.getUserInventoryContents(
                    sender.getSteamID64(),
                    753,
                    6,
                    true,
                    (errUserInv, inv) => { // Renamed 'ERR' to 'errUserInv'
                      if (errUserInv) {
                        logError(errUserInv);
                        client.chatMessage(
                          sender,
                          "I can't load your Steam Inventory. Is it private? \r\n If it's not private, then please try again in a few seconds.",
                        );
                        return null;
                      }
                      const theirGemsArray = inv.filter((gem) => gem.name === 'Gems');
                      if (typeof theirGemsArray[0] === 'undefined') {
                        client.chatMessage(
                          sender,
                          `You don't have enough Gems to make this trade: 0 / ${amountOfGems}`,
                        );
                      } else {
                        const gem = theirGemsArray[0];
                        const gemDifference = amountOfGems - gem.amount;
                        if (gemDifference <= 0) {
                          gem.amount = amountOfGems;
                          t.addTheirItem(gem);
                          manager.getInventoryContents(
                            440,
                            2,
                            true,
                            (errMyInv, myInv) => { // Renamed 'ERR2' to 'errMyInv'
                              if (errMyInv) {
                                logError(errMyInv);
                                return null;
                              }
                              for (let i = 0; i < myInv.length; i += 1) {
                                if (
                                  myKeys.length < parseInt(n, 10) &&
                                  CONFIG.TF2_Keys.includes(myInv[i].market_hash_name)
                                ) {
                                  myKeys.push(myInv[i]);
                                }
                              }
                              if (myKeys.length !== parseInt(n, 10)) {
                                if (myKeys.length > 0) {
                                  client.chatMessage(
                                    sender,
                                    `Sorry, I don't have enough TF2 keys to make this trade: ${myKeys.length} / ${n}\r\nTip: Try using !BuyTF ${myKeys.length}`,
                                  );
                                } else {
                                  client.chatMessage(
                                    sender,
                                    `Sorry, I don't have enough TF2 keys to make this trade: ${myKeys.length} / ${n}, I'll restock soon!`,
                                  );
                                }
                              } else {
                                t.addMyItems(myKeys);
                                t.setMessage('!BuyTF - Enjoy your TF2 Keys :)');
                                t.send((errSend) => { // Renamed 'ERR' to 'errSend'
                                  if (errSend) {
                                    client.chatMessage(
                                      sender,
                                      'Inventory refresh in session. Try again shortly please.',
                                    );
                                    logError(
                                      `## An error occurred while sending trade: ${errSend}`,
                                    );
                                  } else {
                                    log(
                                      `[!BuyTF] Trade Offer Sent!`,
                                    );
                                  }
                                });
                              }
                              return null;
                            },
                          );
                        } else if (
                          Math.floor(
                            gem.amount / CONFIG.Rates.BUY.Gems_To_TF2_Rate,
                          ) > 0
                        ) {
                          client.chatMessage(
                            sender,
                            `You don't have enough Gems to make this trade: ${
                              gem.amount
                            } / ${amountOfGems}\r\nTip: Try using !BuyTF ${Math.floor(
                              gem.amount / CONFIG.Rates.BUY.Gems_To_TF2_Rate,
                            )}`,
                          );
                        } else {
                          client.chatMessage(
                            sender,
                            `You don't have enough Gems to make this trade: ${gem.amount} / ${amountOfGems}`,
                          );
                        }
                      }
                      return null;
                    },
                  );
                  return null;
                }
                client.chatMessage(
                  sender,
                  'Make sure you do not have any Trade Holds.',
                );
                return null;
              });
              return null;
            }
            client.chatMessage(
              sender,
              `You can only buy up to ${CONFIG.Restrictions.MaxBuy} TF2 Keys From me at a time!`,
            );
          } else {
            client.chatMessage(
              sender,
              'Please provide a valid amount of Keys -> !BuyTF [Number of Keys]',
            );
          }
        }
        return null;
      });
    }
    return null; // Added return to satisfy linter
  });

  // Handle accepted trades and log profit
  manager.on('sentOfferChanged', (offer, oldState) => {
    const tradeType = offer.message;
    if (offer.state === 3) { // 3 = Accepted
      const myItems = offer.itemsToGive;
      const theirItems = offer.itemsToReceive;
      const database = JSON.parse(
        fs.readFileSync('./SETTINGS/TotalSold.json').toString('utf8'),
      );

      if (tradeType.includes('!BuyTF')) {
        client.chatMessage(
          offer.partner,
          'Trade Complete! Enjoy your Keys and please +rep my profile so others knows I work :) Have a nice day!',
        );
        CommentUser(offer.partner);
        client.chatMessage(
          CONFIG.Owner[0], // Send to main owner
          `[Profit] Sold my ${myItems.length} TF2 Keys for their ${offer.itemsToReceive[0].amount} Gems`,
        );
        // Profit = (What user paid in gems) - (What bot pays for keys)
        const profit = (myItems.length * CONFIG.Rates.BUY.Gems_To_TF2_Rate) - (myItems.length * CONFIG.Rates.SELL.TF2_To_Gems);
        database.Profit.Buy.TF2[0] += profit;
        database.Profit.Buy.TF2[1] += profit;
        database.Profit.Buy.TF2[2] += profit;
        fs.writeFileSync(
          './SETTINGS/TotalSold.json',
          JSON.stringify(database, undefined, '\t'),
        );
      } else if (tradeType.includes('!SellTF')) {
        // *** BUGFIXED BLOCK ***
        CommentUser(offer.partner);
        client.chatMessage(
          offer.partner,
          'Trade Complete! Enjoy your Gems and please +rep my profile so others knows I work :) Have a nice day!',
        );
        client.chatMessage(
          CONFIG.Owner[0], // Send to main owner
          `[Profit] Bought his ${theirItems.length} TF2 Keys for My ${offer.itemsToGive[0].amount} Gems`,
        );
        // Profit = (What bot sells keys for) - (What user was paid in gems)
        const profit = (theirItems.length * CONFIG.Rates.BUY.Gems_To_TF2_Rate) - (theirItems.length * CONFIG.Rates.SELL.TF2_To_Gems);
        database.Profit.Sell.TF2[0] += profit;
        database.Profit.Sell.TF2[1] += profit;
        database.Profit.Sell.TF2[2] += profit;
        fs.writeFileSync(
          './SETTINGS/TotalSold.json',
          JSON.stringify(database, undefined, '\t'),
        );
      }
      RefreshInventory();
    }
  });
}