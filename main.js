const fs = require('fs');
const cloudscraper = require('cloudscraper');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

// Configuration
const BOT_TOKEN = 'YOUR_BOT_TOKEN';
const TARGET_CHANNEL_ID = 'YOUR_CHANNEL_ID'; // as a string
const COMPETITIVE_API = 'https://www.fortnite.com/competitive/api/blog/getPosts?offset=0&category=&locale=en&rootPageSlug=news&postsPerPage=0';
const NORMAL_API = 'https://www.fortnite.com/api/blog/getPosts?category=&locale=en&offset=0&postsPerPage=0&rootPageSlug=blog&sessionInvalidated=true';
const DATA_FILE = 'old_data.json';
const MESSAGE_DELAY = 2000; // delay in milliseconds
const POLL_INTERVAL = 60000; // 60 seconds

// Logging helper functions
const logDebug = (msg, ...args) => console.debug(new Date().toISOString(), '- DEBUG -', msg, ...args);
const logInfo = (msg, ...args) => console.info(new Date().toISOString(), '- INFO -', msg, ...args);
const logError = (msg, ...args) => console.error(new Date().toISOString(), '- ERROR -', msg, ...args);

// Load stored data
function loadOldData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      logDebug('Loaded old data from', DATA_FILE);
      return data;
    } catch (e) {
      logError('Error loading old data:', e);
    }
  }
  logDebug('No old data found. Starting fresh.');
  return {};
}

// Save data to file
function saveOldData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    logDebug('Saved old data to', DATA_FILE);
  } catch (e) {
    logError('Error saving old data:', e);
  }
}

// Fetch posts from a given URL using cloudscraper
async function fetchPosts(url) {
  try {
    logDebug('Fetching posts from', url);
    const response = await cloudscraper.get(url);
    const json = JSON.parse(response);
    const posts = json.blogList || [];
    logDebug(`Fetched ${posts.length} posts from ${url}`);
    return posts;
  } catch (e) {
    logError(`Error fetching ${url}:`, e);
    return [];
  }
}

// Determine post ID
function getPostId(post) {
  const postId = post._id || post.link || post.slug;
  logDebug('Determined post id:', postId);
  return postId;
}

// Extract description from meta tags
function extractDescription(metaTags = '') {
  const searchKey = 'meta name="description"';
  if (metaTags.includes(searchKey)) {
    try {
      const start = metaTags.indexOf('content="', metaTags.indexOf(searchKey)) + 'content="'.length;
      const end = metaTags.indexOf('"', start);
      const description = metaTags.substring(start, end);
      return description;
    } catch (e) {
      logError('Error extracting description:', e);
      return null;
    }
  }
  return null;
}

// Build an embed from the blog post
function buildEmbed(post, category = '') {
  // Title (remove unwanted text)
  let title = post.title || post.gridTitle || 'No Title';
  title = title.replace('the competitive Fortnite team', '').trim();

  // Description extraction
  let metaTags = post._metaTags || '';
  let description = extractDescription(metaTags);
  if (!description) {
    description = post.content || null;
    if (description && description.length > 1000) {
      description = description.substring(0, 997) + '...';
    }
  }
  if (description && description.includes('<p style=')) {
    description = null;
  }

  // Determine the post link
  let link = '';
  if (post.link && post.link.startsWith('http')) {
    link = post.link;
  } else if (post.slug) {
    link = `https://www.fortnite.com/blog/${post.slug}`;
  } else {
    link = 'https://www.fortnite.com/';
  }

  // Create embed
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x000000) // you can change the color if needed
    .addFields({ name: 'Author', value: post.author || 'Unknown', inline: false })
    .addFields({ name: 'Read More', value: `[Visit Blog Post](${link})`, inline: false });
  
  if (description) {
    embed.setDescription(description);
  }

  // Set thumbnail from image field if it contains "576x576"
  const imageUrl = post.image;
  if (imageUrl && imageUrl.includes('576x576')) {
    embed.setThumbnail(imageUrl);
  }

  // Set main image using the trendingImage field
  if (post.trendingImage) {
    embed.setImage(post.trendingImage);
  }

  logDebug(`Built embed for post id ${getPostId(post)} with title '${title}'`);
  return embed;
}

// Create a new Discord client with required intents
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

let oldData = loadOldData();
let targetChannel = null;

// Polling function
async function blogMonitorLoop() {
  logDebug('Polling APIs for new posts.');
  const newEmbeds = [];

  try {
    const competitivePosts = await fetchPosts(COMPETITIVE_API);
    const normalPosts = await fetchPosts(NORMAL_API);

    // Process Competitive posts
    for (const post of competitivePosts) {
      const postId = getPostId(post);
      if (postId) {
        const trending = post.trending || false;
        if (!oldData[postId] || oldData[postId].trending !== trending) {
          logDebug('New or updated competitive post detected:', postId);
          newEmbeds.push({ embed: buildEmbed(post, 'Competitive'), delay: MESSAGE_DELAY });
          oldData[postId] = { trending };
        } else {
          logDebug('Competitive post already processed:', postId);
        }
      }
    }

    // Process Normal posts
    for (const post of normalPosts) {
      const postId = getPostId(post);
      if (postId) {
        const trending = post.trending || false;
        if (!oldData[postId] || oldData[postId].trending !== trending) {
          logDebug('New or updated normal post detected:', postId);
          newEmbeds.push({ embed: buildEmbed(post, 'Normal'), delay: MESSAGE_DELAY });
          oldData[postId] = { trending };
        } else {
          logDebug('Normal post already processed:', postId);
        }
      }
    }

    if (newEmbeds.length > 0) {
      logInfo(`Found ${newEmbeds.length} new posts. Sending messages to channel.`);
      for (const { embed, delay } of newEmbeds) {
        try {
          await targetChannel.send({ embeds: [embed] });
          logInfo('Sent a new blog post update.');
          // Wait before sending the next message
          await new Promise(resolve => setTimeout(resolve, delay));
        } catch (e) {
          logError('Error sending message:', e);
        }
      }
      saveOldData(oldData);
    } else {
      logInfo('No new posts found.');
    }
  } catch (e) {
    logError('Error in blog monitor loop:', e);
  }
}

// When the bot is ready, find the target channel and start the loop
client.once('ready', async () => {
  logInfo(`Bot is ready and logged in as ${client.user.tag}`);
  try {
    targetChannel = await client.channels.fetch(TARGET_CHANNEL_ID);
    if (!targetChannel) {
      logError('Channel with ID %s not found.', TARGET_CHANNEL_ID);
      return;
    }
    logInfo('Found target channel:', targetChannel.name);
  } catch (e) {
    logError('Error fetching channel:', e);
    return;
  }

  // Start polling immediately, then at every POLL_INTERVAL milliseconds
  blogMonitorLoop();
  setInterval(blogMonitorLoop, POLL_INTERVAL);
});

// Log in the bot
client.login(BOT_TOKEN);