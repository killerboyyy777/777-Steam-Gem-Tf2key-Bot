// -------------------------------------------------------------
// 777-Steam-Gem-Tf2key-Bot
//
// Inspired by work from: **mfw** (https://steamcommunity.com/id/ndevs)
// Recoded and Maintained by: **killerboyyy777** (https://steamcommunity.com/id/klb777)
// © 2025 killerboy777
// Licensed under the GNU General Public License v3.0 (GPLv3).
// -------------------------------------------------------------

const SteamUser = require('steam-user');
const SteamCommunity = require('steamcommunity');
const TradeOfferManager = require('steam-tradeoffer-manager');
const SteamTotp = require('steam-totp');
const fs = require('fs').promises;
const util = require('util');

// --- Global Constants and Setup ---
const CONFIG = require('./SETTINGS/config');
const tradeLogic = require('./tradeLogic');
const packageJson = require('./package.json');

const VERSION = packageJson.version;
const LOG_FILE = 'bot_activity.log';

const TF2_APP_ID = 440;
const TF2_CONTEXT_ID = 2;
const GEM_APP_ID = 753;
const GEM_CONTEXT_ID = 6;
const BLACKLIST_FILE = 'blacklist.json';
const SID64REGEX = /^[0-9]{17}$/;

// Global Bot Info
const GlobalBotInfo = {
  clientSteamID: null,
  userMsgs: {},
};

// --- Helper Functions for I/O and Logging ---

const getTime = () => {
  const time = new Date();
  const hours = String(time.getHours()).padStart(2, '0');
  const minutes = String(time.getMinutes()).padStart(2, '0');
  const seconds = String(time.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

const log = (...args) => {
  // eslint-disable-next-line no-console
  console.log(`[${getTime()}]`, ...args);
};

const logError = (...args) => {
  // eslint-disable-next-line no-console
  console.error(`[${getTime()}] [ERROR]`, ...args);
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes an async function with exponential backoff on failure (retry up to 5 times).
 * @param {function} fn The async function to execute.
 * @param {number} maxRetries The maximum number of retries.
 * @returns {Promise<any>} The result of the successful execution.
 */
const retryWithBackoff = async (fn, maxRetries = 5) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error; // Re-throw the error on the final attempt
      }
      // Exponential backoff with jitter: 200ms * 2^(attempt-1) + random(0-500ms)
      const baseDelay = 200;
      const jitter = Math.floor(Math.random() * 500);
      const backoffTime = baseDelay * 2 ** (attempt - 1) + jitter;
      logError(
        `[Retry] Attempt ${attempt} failed with error: ${error.message}. Retrying in ${backoffTime}ms...`,
      );
      await delay(backoffTime);
    }
  }
};

// --- Configuration Check Function ---
const checkConfig = () => {
  const requiredFields = {
    USERNAME: CONFIG.USERNAME,
    PASSWORD: CONFIG.PASSWORD,
    IDENTITYSECRET: CONFIG.IDENTITYSECRET,
    SHAREDSECRET: CONFIG.SHAREDSECRET,
    STEAMAPIKEY: CONFIG.STEAMAPIKEY,
    OWNER_0: CONFIG.Owner[0],
  };

  let allGood = true;
  log('\n[Configuration Check] Reviewing critical settings...');

  Object.keys(requiredFields).forEach((key) => {
    const value = requiredFields[key];
    const displayValue = value ? `${value.substring(0, 5)}...` : 'Missing';

    if (!value || (typeof value === 'string' && value.trim() === '')) {
      logError(`[Config] ${key}: ${displayValue}`);
      allGood = false;
    } else {
      log(`[Config] ${key}: ${displayValue}`);
    }
  });

  if (!allGood) {
    logError(
      '\n[FATAL] One or more critical configuration values are "Missing".'
            + '\nPlease open ./SETTINGS/config.js and fill in your Steam credentials (USERNAME, PASSWORD, IDENTITYSECRET, SHAREDSECRET) and your SteamID64 in the Owner array (Owner[0]).'
            + '\nBot will now exit.',
    );
    process.exit(1);
  }

  log('[Configuration Check] All critical values are present. Starting bot...');
  log('---------------------------------------------------------------------');
};

// Load the Blacklist from the file.
const loadBlacklist = async (config) => {
  try {
    const data = await fs.readFile(BLACKLIST_FILE, 'utf8');
    config.Ignore_Msgs = JSON.parse(data);
    log(`[INIT] Loaded ${config.Ignore_Msgs.length} entries from blacklist.`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      log('[INIT] blacklist.json not found, starting with an empty blacklist.');
      config.Ignore_Msgs = [];
    } else {
      logError(`[ERROR] Error loading blacklist: ${error.message}`);
      config.Ignore_Msgs = [];
    }
  }
};

// Save the Blacklist to the file.
const saveBlacklist = async (config) => {
  try {
    await fs.writeFile(BLACKLIST_FILE, JSON.stringify(config.Ignore_Msgs, null, 2), 'utf8');
  } catch (error) {
    logError(`[FATAL] Error saving blacklist: ${error.message}`);
  }
};

const main = async () => {
  // Run the check before initializing other components
  checkConfig();

  // --- Steam Client and TradeOfferManager Setup ---
  const client = new SteamUser();
  const manager = new TradeOfferManager({
    language: 'en',
    steam: client,
    pollInterval: '15000',
    cancelTime: '25000',
  });
  const community = new SteamCommunity();

  // --- CORE ASYNC HELPERS (Promisified Steam API Wrappers) ---

  // Wrapped with retryWithBackoff for robustness against Steam API failures
  const getInventoryContentsAsync = (steamID, appid, contextid, tradable) => retryWithBackoff(
    () => new Promise((resolve, reject) => {
      manager.getInventoryContents(steamID, appid, contextid, tradable, (err, inv) => {
        if (err) return reject(err);
        resolve(inv || []);
      });
    }),
  );

  const getUserDetailsAsync = (offer) => new Promise((resolve, reject) => {
    offer.getUserDetails((err, me, them) => {
      if (err) return reject(err);
      resolve({ me, them });
    });
  });

  const getInventoryGems = async (steamID) => {
    try {
      // This internally uses the retried getInventoryContentsAsync
      const inv = await getInventoryContentsAsync(steamID, GEM_APP_ID, GEM_CONTEXT_ID, true);
      const gemItem = inv.find((item) => item.name === 'Gems');
      return gemItem ? gemItem.amount : 0;
    } catch (error) {
      logError(
        `[Inventory Fetch] Failed to get gem count for ${steamID.getSteamID64()} after retries: ${error.message}`,
      );
      return 0;
    }
  };

  const getUserCommunityInvAsync = util.promisify(community.getUserInventoryContents).bind(community);

  // --- MARKET GRIND HELPER (For AutoGem) ---
  /**
     * Executes the Steam Market Grind to convert an item to gems.
     * @param {string} sessionID - The Steam web session ID.
     * @param {object} item - The item to grind.
     * @returns {Promise<object>} The HTTP response object.
     */

  const grindItemToGoo = (sessionID, item) => new Promise((resolve, reject) => {
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
          // Reject on error or non-200 status for retry
          return reject(new Error(`Market Grind Failed: ${err || res.statusCode} for item ${item.market_hash_name}`));
        }
        resolve(res);
      },
    );
  });

  // --- CORE TRADE LOGIC ---

  /**
   * Sends a structured trade offer after checking for holds and items.
   * @param {string} senderID64 - The SteamID64 of the user to send the offer to.
   * @param {number} keyAmount - The number of TF2 keys being traded.
   * @param {number} gemAmount - The number of gems being traded.
   * @param {object[]} botItems - An array of item objects for the bot's side of the trade.
   * @param {object[]} userItems - An array of item objects for the user's side of the trade.
   * @param {string} message - The message to include with the trade offer.
   * @returns {Promise<boolean>} True if the offer was sent successfully, false otherwise.
   */
  const sendTradeOffer = async (senderID64, keyAmount, gemAmount, botItems, userItems, message) => {
    const t = manager.createOffer(senderID64);

    try {
      // 1. Check for trade holds
      const { me, them } = await getUserDetailsAsync(t);

      if (me.escrowDays !== 0 || them.escrowDays !== 0) {
        client.chatMessage(senderID64, 'Make sure you do not have any Trade Holds.');
        return false;
      }

      // 2. Add items to the trade offer
      if (botItems.length > 0) t.addMyItems(botItems);
      if (userItems.length > 0) t.addTheirItems(userItems);

      // 3. Send processing messages and wait
      client.chatMessage(senderID64, `You requested to trade ${keyAmount} Keys for ${gemAmount} Gems.`);
      await delay(1500);
      client.chatMessage(senderID64, 'Trade Processing');
      await delay(1500);
      client.chatMessage(senderID64, 'Please hold...');
      await delay(1500);

      // 4. Send the trade offer (TradeOfferManager handles its own retries/logic, so no need to double-wrap)
      t.setMessage(message);
      await new Promise((resolve, reject) => {
        t.send((errSend) => {
          if (errSend) return reject(errSend);
          resolve();
        });
      });

      log(`[Trade Sent] Offer for ${keyAmount} Keys sent to ${senderID64}`);
      return true;
    } catch (err) {
      logError(`[Trade Failed] Error sending offer to ${senderID64}: ${err.message}`);

      let userMessage = 'An error occurred while preparing or sending the trade. Please try again in a few seconds.';

      // Check for EResult codes
      if (err.eresult) {
        switch (err.eresult) {
          case 15: // k_EResultAccessDenied
          case 16: // k_EResultInvalidAccount
            userMessage = "I can't send you a trade. Is your inventory set to public?";
            break;
          case 25: // k_EResultLimitExceeded
            userMessage = 'It looks like your inventory is full. Please make space and try again.';
            break;
          case 26: // k_EResultRevoked (often means trade ban or escrow)
            userMessage = 'There is an issue with your account (e.g., trade ban or escrow). I cannot send a trade.';
            break;
          default:
            userMessage = `I received an unknown error from Steam (${err.eresult}). Please try again later.`;
            break;
        }
      }

      client.chatMessage(senderID64, userMessage);
      return false;
    }
  };

  // Comments on user profile after trade
  const commentUser = (steamID64) => {
    if (CONFIG.Comment_After_Trade) {
      community.postUserComment(steamID64, CONFIG.Comment_After_Trade, (err) => {
        if (err) {
          logError(`Failed to post comment to ${steamID64}: ${err.message}`);
          return;
        }
        log(`[Commented] Post-trade comment sent to ${steamID64}`);
      });
    }
  };

  // Processes incoming trade offers by checking type and calling tradeLogic handlers.
  const processTradeOffer = (offer) => {
    const partnerID = offer.partner.getSteamID64();

    offer.getUserDetails((errTrade) => {
      if (errTrade) {
        logError(`An error occurred while processing a trade : ${errTrade}`);
        return;
      }

      // Auto-accept admin trades
      if (CONFIG.Owner.includes(partnerID)) {
        offer.accept((errAccept) => {
          if (errAccept) {
            logError(`Error occurred while auto accepting admin trades : ${errAccept}`);
            return;
          }
          log(`[Accepted Offer] | ${partnerID}`);
        });
        return;
      }

      // Auto-accept donations (user gives items, bot gives none)
      if (offer.itemsToGive.length === 0) {
        offer.accept((errAccept) => {
          if (errAccept) {
            logError(`Error occurred accepting donations : ${errAccept}`);
            return;
          }
          log(`[Donation Accepted] | ${partnerID}`);
          client.chatMessage(partnerID, 'Your donation is appreciated!');
        });
        return;
      }

      // --- Modularized Item-based Trade Logic (BG/Emote buy/sell) ---
      if (offer.itemsToReceive.length > 0) {
        const myItems = offer.itemsToGive;
        const theirItems = offer.itemsToReceive;

        // Selling the bot's BGs/Emotes for the user's Gems (Bot gives items, User gives Gems)
        if (myItems.length > 0 && myItems.some((item) => item.type && (item.type.includes('Profile Background') || item.type.includes('Emoticon')))) {
          tradeLogic.sellBgsAndEmotes(offer);
          return;
        }

        // Buying the user's BGs/Emotes for the bot's Gems (Bot gives Gems, User gives items)
        if (theirItems.length > 0 && theirItems.some((item) => item.type && (item.type.includes('Profile Background') || item.type.includes('Emoticon')))) {
          tradeLogic.buyBgsAndEmotes(offer);
          return;
        }
      }

      // Decline all other offers (item-to-item, invalid, etc.)
      offer.decline((errDecline) => {
        if (errDecline) {
          logError(`Error declining the trade offer : ${errDecline}`);
          return;
        }
        log(`[Declined Offer] | ${partnerID}`);
      });
    });
  };

  /* eslint-disable no-promise-executor-return */
  // Converts unwanted items to gems
  const autoGemItems = async () => {
    try {
      log('[AutoGem] Checking inventory for items to convert...');

      const sessionID = community.getSessionID();
      if (!sessionID) {
        log('[AutoGem] No valid session ID yet, skipping.');
        return;
      }

      // Wrap inventory fetch with retry
      const inventory = await retryWithBackoff(() => getUserCommunityInvAsync(client.steamID, GEM_APP_ID, GEM_CONTEXT_ID, true)).catch((err) => {
        logError('[AutoGem] Failed to retrieve inventory after all retries:', err.message);
        return [];
      });

      if (inventory.length === 0) {
        log('[AutoGem] Inventory empty or unavailable.');
        return;
      }

      const itemsToConvert = inventory.filter((item) => {
        const gemValue = tradeLogic.getGemValue(item);
        return gemValue > CONFIG.Restrictions.Convert_To_Gems;
      });

      let gemmedCount = 0;

      await itemsToConvert.reduce(async (previousPromise, item) => {
        await previousPromise;

        const gemValue = tradeLogic.getGemValue(item);

        log(`[AutoGem] Converting ${item.market_hash_name} (${gemValue} gems)...`);
        gemmedCount += 1;

        // Wrap market grind API call with retry (max 3 attempts for a transactional call)
        await retryWithBackoff(() => grindItemToGoo(sessionID, item), 3).catch((err) => {
          logError(`[AutoGem] Failed to convert ${item.market_hash_name} after all retries: ${err.message}`);
        });

        await delay(1000); // Throttle request rate

        return Promise.resolve();
      }, Promise.resolve());

      log(`[AutoGem] Finished converting ${gemmedCount} items this run.`);
    } catch (err) {
      logError('[AutoGem] Error:', err.message);
    }
  };
    /* eslint-enable no-promise-executor-return */

  // Spam Filter: checks for message spam every second
  setInterval(() => {
    // Simplified array iteration
    Object.keys(GlobalBotInfo.userMsgs).forEach((steamID) => {
      if (GlobalBotInfo.userMsgs[steamID] > CONFIG.MAXMSGPERSEC) {
        client.chatMessage(
          steamID,
          "Sorry but we do not like spamming. You've been removed!",
        );
        client.removeFriend(steamID);
        // Notify Owners
        CONFIG.Owner.forEach((ownerID) => {
          client.chatMessage(
            ownerID,
            `Steam #${steamID} has been removed for spamming`,
          );
        });
      }
    });
    GlobalBotInfo.userMsgs = {};
  }, 1000);

  // Load Blacklist on startup
  await loadBlacklist(CONFIG);

  // Function to update the bot's "playing" status with the current gem count
  const updatePlayingStatus = async () => {
    try {
      // Uses the retried inventory fetch
      const INV = await getInventoryContentsAsync(client.steamID, GEM_APP_ID, GEM_CONTEXT_ID, true);
      let myGems = 0;
      const MyGems = INV.filter((gem) => gem.name === 'Gems');
      if (MyGems.length > 0) {
        myGems = MyGems[0].amount;
      }

      const playThis = `${myGems} Gems > Buy/Sell Gems (!prices)`;
      client.gamesPlayed(playThis, true);
    } catch (errInv) {
      logError('Could not load inventory for status update after retries:', errInv.message);
    }
  };

  client.on('loggedOn', () => {
    client.getPersonas([client.steamID], () => {
      log('Successfully Logged Into Your Bot Account');
      client.setPersona(1); // Set status to Online (1)
    });
  });

  client.on('webSession', async (sessionID, cookies) => {
    manager.setCookies(cookies);
    community.setCookies(cookies);
    community.startConfirmationChecker(15000, CONFIG.IDENTITYSECRET);

    // Populate GlobalBotInfo
    GlobalBotInfo.clientSteamID = client.steamID.getSteamID64();

    // Define Dependencies after fetching GlobalBotInfo
    const Dependencies = {
      client,
      manager,
      community,
      getInventoryContentsAsync,
      getInventoryGems,
      sendTradeOffer: (id64, keys, gems, botI, userI, msg) => sendTradeOffer(id64, keys, gems, botI, userI, msg),
      log,
      logError,
      commentUser,
    };

    // Pass Dependencies, CONFIG, AND the GlobalBotInfo object by live reference
    tradeLogic.init(Dependencies, CONFIG, GlobalBotInfo);

    // Initial item conversion check
    log('[AutoGem] Starting initial AutoGem check...');
    await autoGemItems();

    // Repeat Autogem once per Week (7 * 24 * 60 * 60 * 1000 ms)
    setInterval(() => {
      log('[AutoGem] Running weekly AutoGem check...');
      autoGemItems();
    }, 7 * 24 * 60 * 60 * 1000);

    // Accept pending friend requests
    Object.keys(client.myFriends).forEach((steamID) => {
      if (client.myFriends[steamID] === 2) { // Relation type 2 is 'Pending Friend Request'
        client.addFriend(steamID);
      }
    });

    // Update 'playing' message with current gem count
    await updatePlayingStatus();
  });

  // Handle new friend requests and send welcome message
  client.on('friendRelationship', (SENDER, REL) => {
    community.getSteamUser(SENDER, (errUser, user) => {
      if (errUser) {
        logError(`Failure checking current friend relationship with new customer : ${errUser}`);
        return;
      }
      if (REL === 2) { // New friend request
        log(`[New Friend] - ${user.name} > ${SENDER.getSteamID64()} - SteamID`);
        client.addFriend(SENDER);
      } else if (REL === 3) { // Friend accepted
        if (CONFIG.INVITETOGROUPID) {
          client.inviteToGroup(SENDER, CONFIG.INVITETOGROUPID);
          client.chatMessage(SENDER, CONFIG.MESSAGES.WELCOME);
        }
      }
    });
  });

  community.on('sessionExpired', (err) => {
    if (!err) {
      log('Session Expired. Relogging.');
      client.webLogOn();
    }
  });

  // Code to accept trade confirmations
  community.on('newConfirmation', (CONF) => {
    log('## New confirmation.');
    community.acceptConfirmationForObject(
      CONFIG.IDENTITYSECRET,
      CONF.id,
      (errConf) => {
        if (errConf) {
          logError(`## An error occurred while accepting confirmation: ${errConf}`);
        } else {
          log('## Confirmation accepted.');
          // Update playing status immediately after a confirmation (likely trade)
          updatePlayingStatus();
        }
      },
    );
  });

  // Detects new trade offers and processes them
  manager.on('newOffer', (offer) => {
    offer.getUserDetails((errDetails) => {
      if (errDetails) {
        logError(errDetails);
        return;
      }
      log(`[New Trade Offer] From: ${offer.partner.getSteamID64()}`);
      processTradeOffer(offer);
    });
  });

  // Handle chat messages and commands
  client.on('friendMessage', async (steamID, message) => {
    const steamID64 = steamID.getSteamID64();

    if (CONFIG.Ignore_Msgs.includes(steamID64)) return;

    community.getSteamUser(steamID, async (errUser, user) => {
      if (errUser) {
        logError(`Failure parsing users Steam Info: ${errUser}`);
        return;
      }
      log(`[Incoming Chat Message] ${user.name} > ${steamID64} : ${message}`);

      // Spam counter update
      if (GlobalBotInfo.userMsgs[steamID64]) {
        GlobalBotInfo.userMsgs[steamID64] += 1;
      } else {
        GlobalBotInfo.userMsgs[steamID64] = 1;
      }

      // --- Command Handling ---
      const normalizedMsg = message.toUpperCase().trim();
      const parts = normalizedMsg.split(' ');
      const command = parts[0];
      const args = parts.slice(1).join(' ');

      // ------------------------------------
      // Admin Commands
      // ------------------------------------
      if (CONFIG.Owner.includes(steamID64)) {
        switch (command) {
          case '!ADMIN': {
            client.chatMessage(steamID64, CONFIG.MESSAGES.ADMINHELP);
            return;
          }
          case '!PROFIT': {
            client.chatMessage(steamID64, 'Calculating profit... (loading inventories)');
            let myGems = 0;
            let myTF2Keys = 0;

            try {
              // Uses the retried inventory fetch
              const [gemInv, keyInv] = await Promise.all([
                getInventoryContentsAsync(client.steamID, GEM_APP_ID, GEM_CONTEXT_ID, true),
                getInventoryContentsAsync(client.steamID, TF2_APP_ID, TF2_CONTEXT_ID, true),
              ]);

              const MyGems = gemInv.filter((gem) => gem.name === 'Gems');
              if (MyGems.length > 0) {
                myGems = MyGems[0].amount;
              }

              myTF2Keys = keyInv.filter((item) => CONFIG.TF2_Keys.includes(item.market_hash_name)).length;

              const profitMsg = `Current stock:\n- Gems: ${myGems}\n- TF2 Keys: ${myTF2Keys}`;
              client.chatMessage(steamID64, profitMsg);
            } catch (err) {
              logError('[!PROFIT] Error loading inventory after retries:', err.message);
              client.chatMessage(steamID64, 'Error loading inventory.');
            }
            return;
          }
          case '!BLOCK': {
            const targetID = args;
            if (SID64REGEX.test(targetID) && !CONFIG.Ignore_Msgs.includes(targetID)) {
              if (CONFIG.Owner.includes(targetID)) {
                client.chatMessage(steamID64, 'An admin cannot be blocked.');
              } else {
                CONFIG.Ignore_Msgs.push(targetID);
                await saveBlacklist(CONFIG);
                client.chatMessage(steamID64, `User ${targetID} blocked and saved to blacklist.`);
                log(`[Admin] User ${targetID} was blocked by ${steamID64}.`);
              }
            } else {
              client.chatMessage(steamID64, 'Usage: !BLOCK [SteamID64]. User may already be blocked or ID is invalid.');
            }
            return;
          }
          case '!UNBLOCK': {
            const targetID = args;
            const initialLength = CONFIG.Ignore_Msgs.length;
            if (SID64REGEX.test(targetID)) {
              CONFIG.Ignore_Msgs = CONFIG.Ignore_Msgs.filter((id) => id !== targetID);
              if (CONFIG.Ignore_Msgs.length < initialLength) {
                await saveBlacklist(CONFIG);
                client.chatMessage(steamID64, `User ${targetID} unblocked and removed from blacklist.`);
                log(`[Admin] User ${targetID} was unblocked by ${steamID64}.`);
              } else {
                client.chatMessage(steamID64, `User ${targetID} was not found in the blacklist.`);
              }
            } else {
              client.chatMessage(steamID64, 'Usage: !UNBLOCK [SteamID64]');
            }
            return;
          }
          case '!BROADCAST': {
            if (args.length === 0) {
              client.chatMessage(steamID64, 'Please provide a message. Use !Broadcast [Message]');
              return;
            }
            const friendSteamIDs = Object.keys(client.myFriends);
            let friendCount = 0;
            const delayMs = 500; // Throttle messages to 500ms

            log(`[Admin] Starting Broadcast from ${steamID64}...`);
            friendSteamIDs.forEach((friendID, idx) => {
              if (client.myFriends[friendID] === 3) { // Relation 3 is 'Friend'
                setTimeout(() => {
                  client.chatMessage(friendID, args);
                }, idx * delayMs); // Stagger messages
                friendCount += 1;
              }
            });

            client.chatMessage(steamID64, `Broadcast sent to ${friendCount} friends.`);
            log(`[Admin] Broadcast sent to ${friendCount} friends: "${args}"`);
            return;
          }
          default:
            break;
        }
      }

      // ------------------------------------
      // User Commands
      // ------------------------------------
      switch (command) {
        case '!HELP': {
          client.chatMessage(steamID64, CONFIG.MESSAGES.HELP);
          break;
        }
        case '!PRICE':
        case '!RATE':
        case '!RATES':
        case '!PRICES': {
          const priceMsg1 = 'Sell Your: \n1 TF2 Key for Our '
                        + `${CONFIG.Rates.SELL.TF2_To_Gems} Gems\n\nBuy Our: \n1 TF2 Key for Your `
                        + `${CONFIG.Rates.BUY.Gems_To_TF2_Rate} Gems\n\nWe're also:\n`;

          const priceMsg2 = 'Buying Your Backgrounds & emotes for '
                        + `${CONFIG.Rates.BUY.BG_And_Emotes} Gems EACH (Flat Rate - Send offer & add correct number of my gems for auto accept.)\n`
                        + 'Selling any of OUR Backgrounds & emotes for '
                        + `${CONFIG.Rates.SELL.BG_And_Emotes} Gems EACH (Flat Rate - Send offer & add correct number of my gems for auto accept.)`;

          client.chatMessage(steamID64, priceMsg1 + priceMsg2);
          break;
        }
        case '!INFO': {
          client.chatMessage(
            steamID64,
            `777-Steam-Gem-Tf2key-Bot v${VERSION}\nI trade TF2 Keys for Gems and other items.\nCreated by: https://steamcommunity.com/id/klb777\nType !prices to see rates or !help for all commands.`,
          );
          break;
        }
        case '!CHECK': {
          let theirTF2 = 0;
          let theirGems = 0;

          try {
            // Uses the retried inventory fetch
            const [tf2Inv, gemInv] = await Promise.all([
              getInventoryContentsAsync(steamID64, TF2_APP_ID, TF2_CONTEXT_ID, true),
              getInventoryContentsAsync(steamID64, GEM_APP_ID, GEM_CONTEXT_ID, true),
            ]);

            theirTF2 = tf2Inv.filter((item) => CONFIG.TF2_Keys.includes(item.market_hash_name)).length;
            const TheirGems = gemInv.filter((gem) => gem.name === 'Gems');
            if (TheirGems.length > 0) {
              theirGems = TheirGems[0].amount;
            }

            let tf2Msg = '';
            let gemsMsg = '';

            if (theirTF2 > 0) {
              tf2Msg = `- I can give you ${
                theirTF2 * CONFIG.Rates.SELL.TF2_To_Gems
              } Gems for them (Use !SellTF ${theirTF2})`;
            }

            const buyableKeys = Math.floor(
              theirGems / CONFIG.Rates.BUY.Gems_To_TF2_Rate,
            );
            if (buyableKeys > 0) {
              const gemsForBuy = buyableKeys * CONFIG.Rates.BUY.Gems_To_TF2_Rate;
              gemsMsg = `- I can give you ${buyableKeys} TF2 Keys for Your ${gemsForBuy} Gems (Use !BuyTF ${buyableKeys})`;
            }

            client.chatMessage(
              steamID64,
              `You have:\n\n${theirTF2} TF2 Keys\n${tf2Msg}\n`
                            + `You have:\n\n${theirGems} Gems ${gemsMsg}`,
            );
          } catch (err) {
            logError('[!CHECK] Error loading user inventory after retries:', err.message);
            client.chatMessage(
              steamID64,
              "I can't load your Steam Inventory. Is it private? Please try again.",
            );
          }
          break;
        }
        case '!SELLTF': {
          tradeLogic.handleSellTF(steamID64, args);
          break;
        }
        case '!BUYTF': {
          tradeLogic.handleBuyTF(steamID64, args);
          break;
        }
        default:
          break;
      }
    });
  });
};

// Initial console header (License/Copyright display) - placed before execution
log(`
\x1b[32m////////////////////////////////////////////////////////////////////////////////////////////////////\x1b[0m
\x1b[31mCopyright (C) 2025 killerboyyy777\x1b[0m
\x1b[31mhttps://steamcommunity.com/id/klb777\x1b[0m
\x1b[32m////////////////////////////////////////////////////////////////////////////////////////////////////\x1b[0m
\x1b[31m777-steam-gem-tf2key-bot Copyright (C) 2025 killerboyyy777\x1b[0m
\x1b[31mThis program comes with ABSOLUTELY NO WARRANTY\x1b[0m
\x1b[31mThis is free software, and you are welcome to redistribute it\x1b[0m
\x1b[31munder certain conditions\x1b[0m
\x1b[31mFor more Information Check the LICENSE File.\x1b[0m
\x1b[32m////////////////////////////////////////////////////////////////////////////////////////////////////\x1b[0m
`);

main();
