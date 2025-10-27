// -------------------------------------------------------------
// 777-Steam-Gem-Tf2key-Bot
//
// Inspired by work from: **mfw** (https://steamcommunity.com/id/ndevs)
// Recoded and Maintained by: **killerboyyy777** (https://steamcommunity.com/id/klb777)
// © 2025 killerboy777
// Licensed under the GNU General Public License v3.0 (GPLv3).
// -------------------------------------------------------------


module.exports = {
  // Steam Account Credentials
  USERNAME: '',
  PASSWORD: '',
  IDENTITYSECRET: '',
  SHAREDSECRET: '',

  INVITETOGROUPID: '103582791474038795', // Steam Group ID, where new friends are invited
  STEAMAPIKEY: '',

  MAXMSGPERSEC: 3, // Max messages allowed per second before user is blocked
  Owner: ['', ''], // [Bot SteamID64, Admin SteamID64, ...]
  Comment_After_Trade: '+Rep! Thanks for Trading with me!', // Comment to post after a successful trade (empty string if none)
  Ignore_Msgs: [], // SteamIDs of users/bots to ignore messages and trade offers from

  Rates: {

    // Buy Rates (Bot buys keys/items from the user - Bot gives Gems)
    BUY: {
      Gems_To_TF2_Rate: 4200, // User gives us X Gems for X of OUR TF2 Keys
      BG_And_Emotes: 10, // Buy THEIR Backgrounds & Emotes for X Gems Each (Base Gem Value * Rate)
    },

    // Sell Rates (Bot sells keys/items to the user - Bot receives Gems)
    SELL: {
      TF2_To_Gems: 3900, // User gives us X TF2 Keys for Our X Gems
      BG_And_Emotes: 25, // Sell OUR Backgrounds & Emotes for X Gems Each (Base Gem Value * Rate)
    },
  },
  Restrictions: {
    MaxSell: 50, // Max TF2 keys user can sell to bot in one trade
    MaxBuy: 50, // Max TF2 keys user can buy from bot in one trade
    Convert_To_Gems: 20, // Minimum gem value for an item to be automatically converted to gems
    ItemsNotForTrade: [ // List names of items here to prevent them from being traded by the bot
      ':cleancake:',
      ':cleankey:',
      'A Clean Garage',
      ':cleandino:',
      ':cleanfloppy:',
      ':dustpan:',
      ':featherduster:',
      ':cleanhourglass:',
      ':goldfeatherduster:',
      'A Work-in-Progress Garage',
      ':cleanseal:',
      'A Slightly Cleaner Garage',
      'A Messy Garage',
      'Dirty and Dusty',
      'All Tidied Up',
    ],
  },
  MESSAGES: {
    WELCOME:
      'Welcome! I\'m your automated trading bot for Gems and TF2 Keys. I also buy and sell Emotes/Backgrounds for Gems. Type !help to see all commands and rates.',
    HELP:
      `Commands: 

!Prices ⮞ Displays all current buy/sell prices. 

!Check ⮞ Checks your current inventory for tradeable items. 

!BuyTF [# of TF2 Keys] ⮞ Buy TF2 Keys for Gems 

!SellTF [# of TF2 Keys] ⮞ Sell TF2 Keys for Gems 

We're also:
Buying Your Backgrounds & Emotes! 
(For current rates, please use !Prices)
(Only Gemmable Backgrounds and Emotes)
Just start a Trade Offer with me and enter any/ all Emoticons/Backgrounds you would like to sell! Then, Add the correct rate of gems from my inventory into the trade. I will auto accept if the rates match/will decline if they do not.`,
    ADMINHELP:
      `Admin Commands:

!Admin ⮞ Displays this admin help menu.
!Profit ⮞ Shows current stock statistics (Keys, Gems).
!Block [SteamID64] ⮞ Blocks a specific user from interacting with the bot.
!Unblock [SteamID64] ⮞ Unblocks a previously blocked user.
!Broadcast [Message] ⮞ Sends the configured message to all friends of the bot.`,
  },
  TF2_Keys: [
    'Mann Co. Supply Crate Key', // List of TF2 Key names
  ],
};