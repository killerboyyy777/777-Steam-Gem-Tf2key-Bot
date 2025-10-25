// tradeLogic.js
// This module contains the logic for all Gem-related trades (TF2 Keys, Backgrounds, Emotes).

// Internal variables to store helper functions and global bot info
let Helpers = {};
// CRITICAL FIX: Renamed to hold the live reference from index.js
let GlobalBotInfoRef = {}; 
let configRef = {};
const TF2_APP_ID = 440;
const TF2_CONTEXT_ID = 2;
const GEM_APP_ID = 753;
const GEM_CONTEXT_ID = 6;

/**
 * Initializes the TradeLogic module with the necessary dependencies from index.js.
 * @param {object} dependencies Contains promisified helpers, logging, and global bot data.
 * @param {object} config The bot configuration object.
 * @param {object} globalBotInfoRef A direct reference to the GlobalBotInfo object from index.js.
 */
const init = (dependencies, config, globalBotInfoRef) => {
  Helpers = dependencies;
  // Store the live reference
  GlobalBotInfoRef = globalBotInfoRef; 
  configRef = config;
};

/**
 * Checks if an item is a tradable Emote or Background and gets its gem value.
 * @param {object} item The Steam inventory item object.
 * @returns {number} The item's base Gem value, or 0 if invalid/not gemmable.
 */
const getGemValue = (item) => {
  const type = item.type?.toLowerCase() || '';
  const name = item.market_hash_name?.toLowerCase() || '';

  // Must be an Emote or Background and must not be a Booster or Gems
  const isEmoteOrBG = type.includes('profile background') || type.includes('emoticon');
  const skip = type.includes('trading card')
        || name.includes('booster')
        || name.includes('gems');

  if (!isEmoteOrBG || skip || !Array.isArray(item.descriptions)) {
    return 0;
  }

  // Find the description line containing the gem value
  const gemInfo = item.descriptions.find((d) => d.value?.includes('This item is worth:'));
  if (!gemInfo) {
    return 0;
  }

  // Extract the numeric gem value
  const match = gemInfo.value.match(/(\d+)\s*Gems?/i);
  return match ? parseInt(match[1], 10) : 0;
};

/**
 * Checks if an item is explicitly blacklisted from being traded by the bot.
 * @param {object} item The Steam inventory item object.
 * @returns {boolean} True if the item is restricted.
 */
const isRestrictedItem = (item) => configRef.Restrictions.ItemsNotForTrade.includes(item.market_hash_name);

// ----------------------------------------------------------
// Command Handlers (TF2 Key Trades)
// ----------------------------------------------------------

/**
 * Handles the !SELLTF command: User sells keys for bot's gems.
 * @param {string} senderID64 User's SteamID64.
 * @param {string} args Command arguments (number of keys).
 */
const handleSellTF = async (senderID64, args) => {
  const nStr = args;
  const n = parseInt(nStr, 10);

  if (!Number.isInteger(n) || n <= 0) {
    Helpers.client.chatMessage(
      senderID64,
      'Please provide a valid amount of Keys -> !SellTF [Number of Keys]',
    );
    return;
  }

  if (n > configRef.Restrictions.MaxSell) {
    Helpers.client.chatMessage(
      senderID64,
      `You can only Sell up to ${configRef.Restrictions.MaxSell} TF2 Keys to me at a time!`,
    );
    return;
  }

  const amountOfGems = n * configRef.Rates.SELL.TF2_To_Gems;

  try {
    // 1. Check Bot's Gems (Uses GlobalBotInfoRef)
    const botGems = await Helpers.getInventoryGems(GlobalBotInfoRef.clientSteamID);

    if (botGems < amountOfGems) {
      const sellableKeys = Math.floor(
        botGems / configRef.Rates.SELL.TF2_To_Gems,
      );
      const lowGemMsg = sellableKeys > 0
        ? `Sorry, I don't have enough Gems: ${botGems} / ${amountOfGems}. Tip: Try using !SellTF ${sellableKeys}`
        : `Sorry, I don't have enough Gems: ${botGems} / ${amountOfGems}. I'll restock soon!`;
      Helpers.client.chatMessage(senderID64, lowGemMsg);
      return;
    }

    // 2. Check User's TF2 Keys
    const userTF2Inv = await Helpers.getInventoryContentsAsync(senderID64, TF2_APP_ID, TF2_CONTEXT_ID, true);
    // Filter out blacklisted keys
    const userKeys = userTF2Inv.filter((item) => (
      configRef.TF2_Keys.includes(item.market_hash_name) 
      && !isRestrictedItem(item)
    ));
    
    if (userKeys.length < n) {
      const lowKeyMsg = userKeys.length > 0
        ? `You don't have enough TF2 keys: ${userKeys.length} / ${n}. Tip: Try using !SellTF ${userKeys.length}`
        : `You don't have enough TF2 keys: ${userKeys.length} / ${n}`;
      Helpers.client.chatMessage(senderID64, lowKeyMsg);
      return;
    }

    // 3. Prepare Items
    const keysToSend = userKeys.slice(0, n);
    
    // Bot's Gem item (Uses GlobalBotInfoRef)
    const botItems = [{
      appid: GEM_APP_ID,
      contextid: GEM_CONTEXT_ID,
      assetid: GlobalBotInfoRef.botGemAssetID,
      amount: amountOfGems,
    }];
    
    // User's items
    const userItems = keysToSend;

    // 4. Send Trade Offer
    const message = `Selling ${n} TF2 Keys for ${amountOfGems} Gems. Thanks for trading!`;
    const tradeSent = await Helpers.sendTradeOffer(senderID64, n, amountOfGems, botItems, userItems, message);
    
    if (tradeSent) {
      Helpers.client.chatMessage(
        senderID64,
        'Trade Offer Sent! Please check your Steam Mobile App to accept it.',
      );
    }

  } catch (err) {
    Helpers.logError(`[SellTF Handler] Error: ${err.message}`);
    Helpers.client.chatMessage(
      senderID64,
      "An unexpected error occurred while processing your request. Please try again or check my inventory status.",
    );
  }
};

/**
 * Handles the !BUYTF command: User buys keys for bot's gems.
 * @param {string} senderID64 User's SteamID64.
 * @param {string} args Command arguments (number of keys).
 */
const handleBuyTF = async (senderID64, args) => {
  const nStr = args;
  const n = parseInt(nStr, 10);

  if (!Number.isInteger(n) || n <= 0) {
    Helpers.client.chatMessage(
      senderID64,
      'Please provide a valid amount of Keys -> !BuyTF [Number of Keys]',
    );
    return;
  }

  if (n > configRef.Restrictions.MaxBuy) {
    Helpers.client.chatMessage(
      senderID64,
      `You can only Buy up to ${configRef.Restrictions.MaxBuy} TF2 Keys from me at a time!`,
    );
    return;
  }

  const amountOfGems = n * configRef.Rates.BUY.Gems_To_TF2_Rate;

  try {
    // 1. Check Bot's TF2 Keys
    const botTF2Inv = await Helpers.getInventoryContentsAsync(GlobalBotInfoRef.clientSteamID, TF2_APP_ID, TF2_CONTEXT_ID, true);
    const botKeys = botTF2Inv.filter((item) => (
      configRef.TF2_Keys.includes(item.market_hash_name) 
      && !isRestrictedItem(item)
    ));

    if (botKeys.length < n) {
      const lowKeyMsg = botKeys.length > 0
        ? `Sorry, I don't have enough TF2 keys: ${botKeys.length} / ${n}. Tip: Try using !BuyTF ${botKeys.length}`
        : `Sorry, I don't have enough TF2 keys: ${botKeys.length} / ${n}. I'll restock soon!`;
      Helpers.client.chatMessage(senderID64, lowKeyMsg);
      return;
    }

    // 2. Check User's Gems
    const userGems = await Helpers.getInventoryGems(senderID64);

    if (userGems < amountOfGems) {
      const buyableKeys = Math.floor(
        userGems / configRef.Rates.BUY.Gems_To_TF2_Rate,
      );
      const lowGemMsg = buyableKeys > 0
        ? `You don't have enough Gems: ${userGems} / ${amountOfGems}. Tip: Try using !BuyTF ${buyableKeys}`
        : `You don't have enough Gems: ${userGems} / ${amountOfGems}`;
      Helpers.client.chatMessage(senderID64, lowGemMsg);
      return;
    }

    // 3. Prepare Items
    const keysToGive = botKeys.slice(0, n);
    
    // User's Gem item (needs their asset ID, which must be fetched)
    const userGemInv = await Helpers.getInventoryContentsAsync(senderID64, GEM_APP_ID, GEM_CONTEXT_ID, true);
    const userGemItem = userGemInv.find((item) => item.name === 'Gems');
    
    if (!userGemItem || userGemItem.amount < amountOfGems) {
        // This is a double-check, but helpful if inventory refreshed in between checks
        Helpers.client.chatMessage(senderID64, "I couldn't verify you have the required Gems right now. Please try again.");
        return;
    }

    const userItems = [{
      appid: GEM_APP_ID,
      contextid: GEM_CONTEXT_ID,
      assetid: userGemItem.assetid,
      amount: amountOfGems,
    }];
    
    // Bot's items
    const botItems = keysToGive;

    // 4. Send Trade Offer
    const message = `Buying ${n} TF2 Keys for ${amountOfGems} Gems. Thanks for trading!`;
    const tradeSent = await Helpers.sendTradeOffer(senderID64, n, amountOfGems, botItems, userItems, message);

    if (tradeSent) {
      Helpers.client.chatMessage(
        senderID64,
        'Trade Offer Sent! Please check your Steam Mobile App to accept it.',
      );
    }
    
  } catch (err) {
    Helpers.logError(`[BuyTF Handler] Error: ${err.message}`);
    Helpers.client.chatMessage(
      senderID64,
      "An unexpected error occurred while processing your request. Please try again or check my inventory status.",
    );
  }
};

// ----------------------------------------------------------
// Trade Offer Logic (BGs/Emotes)
// ----------------------------------------------------------

/**
 * Handles trade offers where the user is selling BGs/Emotes for the bot's gems. (Bot pays Gems).
 * @param {object} offer The TradeOffer object.
 */
const buyBgsAndEmotes = async (offer) => {
  const partnerID = offer.partner.getSteamID64();
  const flatRate = configRef.Rates.BUY.BG_And_Emotes;

  const userItems = offer.itemsToReceive.filter((item) => {
    // Check if item is gemmable (using the rate defined in the module)
    const gemValue = getGemValue(item);
    return gemValue > 0 && !isRestrictedItem(item);
  });

  const botItems = offer.itemsToGive;

  // 1. Calculate required gems
  const calculatedGems = userItems.length * flatRate;
  
  if (userItems.length === 0) {
    Helpers.client.chatMessage(
      partnerID,
      'Trade declined. You must include valid Backgrounds or Emotes for me to buy.',
    );
    offer.decline();
    return;
  }
  
  // 2. Extract bot's offered items (should only be a single stack of gems)
  let botGems = 0;
  if (botItems.length === 1 && botItems[0].name === 'Gems') {
      botGems = botItems[0].amount;
  }

  // 3. Verify trade contents
  if (botItems.length !== 1 || botItems[0].name !== 'Gems') {
      Helpers.client.chatMessage(
        partnerID,
        'Trade declined. Please offer ONLY the correct amount of Gems from my inventory (The bot gives Gems, you give items).',
      );
      offer.decline();
      return;
  }
  
  // 4. Verify Gem Amount
  if (botGems !== calculatedGems) {
    Helpers.client.chatMessage(
      partnerID,
      `Trade declined. I offered ${botGems} Gems, but ${userItems.length} items are worth ${calculatedGems} Gems at my flat rate of ${flatRate} Gems/item.`,
    );
    offer.decline();
    return;
  }

  // 5. Secondary check for the bot's current Gem stock (for robustness) (Uses GlobalBotInfoRef)
  try {
    const currentBotGems = await Helpers.getInventoryGems(GlobalBotInfoRef.clientSteamID);
    if (currentBotGems < calculatedGems) {
      Helpers.client.chatMessage(
        partnerID,
        'Trade declined. I do not have enough Gems in my inventory right now. Please try again later.',
      );
      offer.decline();
      return;
    }
  } catch (err) {
    Helpers.logError(`[Buy BGs/Emotes] Error checking bot inventory: ${err.message}`);
    Helpers.client.chatMessage(
      partnerID,
      'An error occurred while checking my inventory. Please try again.',
    );
    offer.decline();
    return;
  }

  // 6. Accept the Trade Offer
  offer.accept((err) => {
    if (err) {
      Helpers.logError(`[Buy BGs/Emotes] Error accepting offer from ${partnerID}: ${err.message}`);
      Helpers.client.chatMessage(
        partnerID,
        'An error occurred while accepting the trade. Please try again.',
      );
      return;
    }
    Helpers.log(`[Buy BGs/Emotes Accepted] from ${partnerID}. Bot gave ${botGems} Gems.`);
    Helpers.commentUser(partnerID);
  });
};

/**
 * Handles trade offers where the user is buying BGs/Emotes for the bot's gems. (User pays Gems).
 * @param {object} offer The TradeOffer object.
 */
const sellBgsAndEmotes = async (offer) => {
  const partnerID = offer.partner.getSteamID64();
  const flatRate = configRef.Rates.SELL.BG_And_Emotes;

  const botItems = offer.itemsToGive.filter((item) => {
    // Check if item is gemmable (using the rate defined in the module)
    const gemValue = getGemValue(item);
    return gemValue > 0 && !isRestrictedItem(item);
  });

  const userItems = offer.itemsToReceive;

  // 1. Calculate required gems
  const calculatedGems = botItems.length * flatRate;
  
  if (botItems.length === 0) {
    Helpers.client.chatMessage(
      partnerID,
      'Trade declined. I must include valid Backgrounds or Emotes for you to buy from me.',
    );
    offer.decline();
    return;
  }
  
  // 2. Extract user's offered items (should only be a single stack of gems)
  let userGems = 0;
  if (userItems.length === 1 && userItems[0].name === 'Gems') {
      userGems = userItems[0].amount;
  }
  
  // 3. Verify trade contents
  if (userItems.length !== 1 || userItems[0].name !== 'Gems') {
      Helpers.client.chatMessage(
        partnerID,
        'Trade declined. Please offer ONLY the correct amount of Gems.',
      );
      offer.decline();
      return;
  }

  // 4. Verify Gem Amount
  if (userGems !== calculatedGems) {
    Helpers.client.chatMessage(
      partnerID,
      `Trade declined. You offered ${userGems} Gems, but ${botItems.length} items are worth ${calculatedGems} Gems at my flat rate of ${flatRate} Gems/item.`,
    );
    offer.decline();
    return;
  }
  
  // 5. Secondary check for the user's current Gem stock (for robustness)
  try {
    const currentUserGems = await Helpers.getInventoryGems(partnerID);
    if (currentUserGems < calculatedGems) {
      Helpers.client.chatMessage(
        partnerID,
        'Trade declined. You do not have enough Gems in your inventory right now. Please try again later.',
      );
      offer.decline();
      return;
    }
  } catch (err) {
    Helpers.logError(`[Sell BGs/Emotes] Error checking user inventory: ${err.message}`);
    Helpers.client.chatMessage(
      partnerID,
      'An error occurred while checking your inventory. Please try again.',
    );
    offer.decline();
    return;
  }

  // 6. Accept the Trade Offer
  offer.accept((err) => {
    if (err) {
      Helpers.logError(`[Sell BGs/Emotes] Error accepting offer from ${partnerID}: ${err.message}`);
      Helpers.client.chatMessage(
        partnerID,
        'An error occurred while accepting the trade. Please try again.',
      );
      return;
    }
    Helpers.log(`[Sell BGs/Emotes Accepted] from ${partnerID}. User gave ${userGems} Gems.`);
    Helpers.commentUser(partnerID);
  });
};


module.exports = {
  init,
  getGemValue, // Exported for use in index.js autoGemItems
  handleSellTF,
  handleBuyTF,
  buyBgsAndEmotes,
  sellBgsAndEmotes,
};