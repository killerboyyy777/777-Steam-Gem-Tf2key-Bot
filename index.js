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


// --- Global Constants and Setup ---
const CONFIG = require('./SETTINGS/config');
const tradeLogic = require('./tradeLogic');
const packageJson = require('./package.json');

const VERSION = packageJson.version;


const TF2_APP_ID = 440;
const TF2_CONTEXT_ID = 2;
const GEM_APP_ID = 753;
const GEM_CONTEXT_ID = 6;
const BLACKLIST_FILE = 'blacklist.json';
const SID64REGEX = /^[0-9]{17}$/;

// Global Bot Info
const botState = {
  bot: {
    inventory: {},
    gemCount: 0,
  },
  users: {},
  community: {},
};

const GlobalBotInfo = {
  clientSteamID: null,
  userMsgs: {},
  sessionID: null,
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
    } else {
      logError(`[ERROR] Error loading blacklist: ${error.message}`);
    }
    config.Ignore_Msgs = [];
  }
};

// Save the Blacklist to the file.
const saveBlacklist = async (config) => {
  try {
    await fs.writeFile(BLACKLIST_FILE, JSON.stringify(config.Ignore_Msgs, null, 2), 'utf8');
  } catch (error) {
    logError(`[ERROR] Error saving blacklist: ${error.message}`);
  }
};

const main = async () => {
  // Run the check before initializing other components
  checkConfig();

  // --- Steam Client and TradeOfferManager Setup ---
  const client = new SteamUser();

  client.on('error', (e) => {
    if (e.eresult === SteamUser.EResult.LogonSessionReplaced) {
      logError('Logon session replaced. Trying to log back in...');
      setTimeout(() => {
        client.logOn({
          accountName: CONFIG.USERNAME,
          password: CONFIG.PASSWORD,
          twoFactorCode: SteamTotp.generateAuthCode(CONFIG.SHAREDSECRET),
        });
      }, 15000); // 15-second delay before trying to log back in
    } else if (e.eresult) {
      logError(`An unhandled error occurred with EResult: ${SteamUser.EResult[e.eresult]} (${e.eresult})`);
    } else {
      logError(`An unhandled error occurred: ${e.message}`);
    }
  });

  const manager = new TradeOfferManager({
    language: 'en',
    steam: client,
    pollInterval: '15000',
    cancelTime: '25000',
  });
  const community = new SteamCommunity();

  const updateBotGemCountAndStatus = async () => {
    try {
      const inv = await getInventoryContentsAsync(client.steamID, GEM_APP_ID, GEM_CONTEXT_ID, true);
      const gemItem = inv.find((item) => item.name === 'Gems');
      global.bot.gemCount = gemItem ? gemItem.amount : 0;
      updatePlayingStatus();
    } catch (e) {
      logError('[updateBotGemCountAndStatus] An error occurred:', e);
    }
  };

  // --- CORE ASYNC HELPERS (Promisified Steam API Wrappers) ---

  // Wrapped with retryWithBackoff for robustness against Steam API failures
  const getInventory = (steamID, appid, contextid) => new Promise((resolve) => {
    const cacheKey = `${steamID}-${appid}-${contextid}`;
    const cached = global.users[cacheKey];
    const cacheDuration = 1000 * 60 * CONFIG.Restrictions.CACHE_DURATION_MINUTES;

    if (cached && cached.inventory && (Date.now() - cached.inventory.timestamp < cacheDuration)) {
      resolve(cached.inventory.items);
    } else {
      community.getUserInventoryContents(steamID, appid, contextid, true, (err, inv) => {
        if (err) {
          logError(`Error loading inventory for ${steamID}: ${err.message}`);
          resolve([]);
        } else {
          global.users[cacheKey] = {
            inventory: {
              items: inv,
              timestamp: Date.now(),
            },
          };
          resolve(inv);
        }
      });
    }
  });

  const getInventoryContentsAsync = (steamID, appid, contextid, tradable) => retryWithBackoff(
    () => getInventory(steamID, appid, contextid, tradable),
  );

  const getUserDetailsAsync = (offer) => new Promise((resolve, reject) => {
    offer.getUserDetails((err, me, them) => {
      if (err) return reject(err);
      resolve({ me, them });
    });
  });

  const getUserInventory = async (steamID) => {
    const [tf2Inv, gemInv] = await Promise.all([
      getInventoryContentsAsync(steamID, TF2_APP_ID, TF2_CONTEXT_ID, true),
      getInventoryContentsAsync(steamID, GEM_APP_ID, GEM_CONTEXT_ID, true),
    ]);

    const tf2Keys = tf2Inv.filter((item) => CONFIG.TF2_Keys.includes(item.market_hash_name)).length;
    const gems = gemInv.filter((gem) => gem.name === 'Gems');
    const gemCount = gems.length > 0 ? gems[0].amount : 0;

    return { tf2Keys, gemCount };
  };

  // --- MARKET GRIND HELPER (For AutoGem) ---
  /**
     * Executes the Steam Market Grind to convert an item to gems.
     * @param {string} sessionID - The Steam web session ID.
     * @param {object} item - The item to grind.
     * @returns {Promise<object>} The HTTP response object.
     */

  const grindItemToGoo = (sessionID, item, gemValue) => new Promise((resolve, reject) => {
    community.httpRequestPost(
      {
        uri: 'https://steamcommunity.com/market/grindintogoo/',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Referer: `https://steamcommunity.com/profiles/${client.steamID.getSteamID64()}/inventory/`,
        },
        formData:
        {
          sessionid: sessionID,
          appid: String(item.appid),
          assetid: String(item.assetid),
          contextid: String(item.contextid),
          goo_value_expected: String(gemValue),
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
          case SteamUser.EResult.AccessDenied: // 15
          case SteamUser.EResult.InvalidAccount: // 16
            userMessage = "I can't send you a trade. Is your inventory set to public?";
            break;
          case SteamUser.EResult.LimitExceeded: // 25
            userMessage = 'It looks like your inventory is full. Please make space and try again.';
            break;
          case SteamUser.EResult.Revoked: // 26
            userMessage = 'There is an issue with your account (e.g., trade ban or escrow). I cannot send a trade.';
            break;
          default:
            userMessage = `I received an unknown error from Steam (${SteamUser.EResult[err.eresult] || err.eresult}). Please try again later.`;
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
      log(`[DEBUG] Calling postUserComment for ${steamID64}`);
      community.postUserComment(steamID64, String(CONFIG.Comment_After_Trade), (err) => {
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
  /* eslint-disable no-restricted-syntax */
  // Converts unwanted items to gems
  const autoGemItems = async () => {
    try {
      log('[AutoGem] Checking inventory for items to convert...');

      if (!GlobalBotInfo.sessionID) {
        log('[AutoGem] No valid session ID in GlobalBotInfo yet, skipping.');
        return;
      }

      // eslint-disable-next-line max-len
      const inventory = await getInventoryContentsAsync(client.steamID, GEM_APP_ID, GEM_CONTEXT_ID, true).catch((err) => {
        logError('[AutoGem] Failed to retrieve inventory after all retries:', err.message);
        return []; // Return an empty array on final failure
      });

      if (inventory.length === 0) {
        log('[AutoGem] Inventory empty or unavailable.');
        return;
      }

      let gemmedCount = 0;

      for (const item of inventory) {
        const gemValue = tradeLogic.getGemValue(item);

        if (gemValue > CONFIG.Restrictions.Convert_To_Gems) {
          log(`[AutoGem] Converting ${item.market_hash_name} (${gemValue} gems)...`);
          gemmedCount += 1;

          try {
            // Pass the globally stored sessionID and the gemValue
            await retryWithBackoff(() => grindItemToGoo(GlobalBotInfo.sessionID, item, gemValue), 3);
            log(`[AutoGem] Successfully converted ${item.market_hash_name}.`);
          } catch (err) {
            logError(`[AutoGem] Failed to convert ${item.market_hash_name} after all retries: ${err.message}`);
          }
          // Throttle requests to avoid rate limiting
          await delay(5000);
        }
      }

      log(`[AutoGem] Finished converting ${gemmedCount} items this run.`);
    } catch (err) {
      logError('[AutoGem] Error:', err.message);
    }
  };
    /* eslint-enable no-promise-executor-return */
    /* eslint-enable no-restricted-syntax */

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
  const updatePlayingStatus = () => {
    const playThis = `${global.bot.gemCount} Gems > Buy/Sell Gems (!prices)`;
    client.gamesPlayed(playThis, true);
  };

  client.on('loggedOn', () => {
    client.getPersonas([client.steamID], () => {
      log('Successfully Logged Into Your Bot Account');
      client.setPersona(1); // Set status to Online (1)
    });
  });

  client.on('webSession', async (sessionID, cookies) => {
    GlobalBotInfo.sessionID = sessionID;
    log(`[INIT] Web Session ID captured: ${sessionID.substring(0, 10)}...`);
    manager.setCookies(cookies);
    community.setCookies(cookies);
    community.startConfirmationChecker(15000, CONFIG.IDENTITYSECRET);

    // Populate GlobalBotInfo
    GlobalBotInfo.clientSteamID = client.steamID.getSteamID64();

    const Dependencies = {
      client,
      manager,
      community,
      getInventoryContentsAsync,
      sendTradeOffer: (id64, keys, gems, botI, userI, msg) => sendTradeOffer(id64, keys, gems, botI, userI, msg),
      log,
      logError,
      commentUser,
    };

    // Pass Dependencies, CONFIG, AND the GlobalBotInfo object by live reference
    tradeLogic.init(Dependencies, CONFIG, GlobalBotInfo);

    // Initial item conversion check with a delay
    log('[INIT] Waiting 5s for session to stabilize...');
    await delay(5000);

    log('[INIT] Performing initial inventory check...');
    await updateBotGemCountAndStatus();
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
  });

  const getSteamUser = (steamID) => new Promise((resolve, reject) => {
    const cachedUser = global.community[steamID];
    const cacheDuration = 1000 * 60 * 60 * CONFIG.Restrictions.CACHE_USER_PROFILE_DURATION_HOURS;

    if (cachedUser && (Date.now() - cachedUser.timestamp < cacheDuration)) {
      resolve(cachedUser.user);
    } else {
      community.getSteamUser(steamID, (err, user) => {
        if (err) {
          reject(err);
        } else {
          global.community[steamID] = {
            user,
            timestamp: Date.now(),
          };
          resolve(user);
        }
      });
    }
  });

  // Handle new friend requests and send welcome message
  client.on('friendRelationship', (SENDER, REL) => {
    log(`[DEBUG] Calling getSteamUser for ${SENDER.getSteamID64()} in friendRelationship`);

    getSteamUser(SENDER)
      .then((user) => {
      // This code now runs only on success
        if (REL === 2) { // New friend request
          log(
            `[New Friend] - ${user.name} > ${SENDER.getSteamID64()} - SteamID`,
          );
          client.addFriend(SENDER);
        } else if (REL === 3) { // Friend accepted
          if (CONFIG.INVITETOGROUPID) {
            client.inviteToGroup(SENDER, CONFIG.INVITETOGROUPID);
            client.chatMessage(SENDER, CONFIG.MESSAGES.WELCOME);
          }
        }
      })
      .catch((err) => {
      // This code now runs only on failure
        logError(`Failure checking current friend relationship with new customer : ${err.message}`);
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
          updateBotGemCountAndStatus();
        }
      },
    );
  });

  manager.on('sentOfferChanged', (offer, oldState) => {
    if (offer.state === TradeOfferManager.ETradeOfferState.Accepted) {
      log(`[Trade Accepted] Offer #${offer.id} with ${offer.partner.getSteamID64()} accepted.`);

      const partnerSteamID = offer.partner.getSteamID64();
      const botSteamID = client.steamID.getSteamID64();

      // Invalidate partner's inventory caches
      const partnerTf2CacheKey = `${partnerSteamID}-${TF2_APP_ID}-${TF2_CONTEXT_ID}`;
      const partnerGemCacheKey = `${partnerSteamID}-${GEM_APP_ID}-${GEM_CONTEXT_ID}`;
      delete global.users[partnerTf2CacheKey];
      delete global.users[partnerGemCacheKey];

      // Invalidate bot's inventory caches
      const botTf2CacheKey = `${botSteamID}-${TF2_APP_ID}-${TF2_CONTEXT_ID}`;
      const botGemCacheKey = `${botSteamID}-${GEM_APP_ID}-${GEM_CONTEXT_ID}`;
      delete global.users[botTf2CacheKey];
      delete global.users[botGemCacheKey];

      log(`[Cache] Invalidated inventories for ${partnerSteamID} and ${botSteamID}.`);

      updateBotGemCountAndStatus();
    }
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

    getSteamUser(steamID)
      .then(async (user) => {
        // This code now runs only on success
        log(
          `[Incoming Chat Message] ${user.name} > ${steamID64} : ${message}`,
        );

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

              try {
                const inventory = await getUserInventory(client.steamID);
                global.bot.gemCount = inventory.gemCount;

                const profitMsg = `Current stock:\n- Gems: ${inventory.gemCount}\n- TF2 Keys: ${inventory.tf2Keys}`;
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
                            + `${CONFIG.Rates.BUY.Gems_To_TF2_Rate} Gems\n\nWe are also:\n`;

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
            try {
              const inventory = await getUserInventory(steamID64);

              let tf2Msg = '';
              let gemsMsg = '';

              if (inventory.tf2Keys > 0) {
                tf2Msg = `- I can give you ${
                  inventory.tf2Keys * CONFIG.Rates.SELL.TF2_To_Gems
                } Gems for them (Use !SellTF ${inventory.tf2Keys})`;
              }

              const buyableKeys = Math.floor(
                inventory.gemCount / CONFIG.Rates.BUY.Gems_To_TF2_Rate,
              );
              if (buyableKeys > 0) {
                const gemsForBuy = buyableKeys * CONFIG.Rates.BUY.Gems_To_TF2_Rate;
                gemsMsg = `- I can give you ${buyableKeys} TF2 Keys for Your ${gemsForBuy} Gems (Use !BuyTF ${buyableKeys})`;
              }

              client.chatMessage(
                steamID64,
                `You have:\n\n- ${inventory.tf2Keys} TF2 Keys\n${tf2Msg}\n\n- ${inventory.gemCount} Gems\n${gemsMsg}`,
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
      })
      .catch((err) => {
        // This code now runs only on failure
        logError(`Failure parsing users Steam Info: ${err.message}`);
      });
  }); // Initiate the login process after all listeners are set
  log('[INIT] Logging into Steam...');
  client.logOn({
    accountName: CONFIG.USERNAME,
    password: CONFIG.PASSWORD,
    twoFactorCode: SteamTotp.generateAuthCode(CONFIG.SHAREDSECRET),
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
