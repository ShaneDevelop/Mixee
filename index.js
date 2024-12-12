const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const SpotifyWebApi = require('spotify-web-api-node');
const OpenAI = require('openai');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const PlaylistThumbnailGenerator = require('./PlaylistThumbnailGenerator');
const Stripe = require('stripe');


// To Do List:
  // Add actually giving the user perks when they buy premium
  // 







const app = express();
dotenv.config();

let bannedUsers = [];

const getBannedUsers = () => {
  bannedUsers = JSON.parse(fs.readFileSync('./private/banned-users.json', 'utf-8'));
  setInterval(getBannedUsers, 10000);
}

getBannedUsers();

// User file storage functions
const getUserData = (userId) => {
  const userPath = path.join(__dirname, 'private', 'users', `user-${userId}.json`);
  try {
    if (fs.existsSync(userPath)) {
      return JSON.parse(fs.readFileSync(userPath, 'utf-8'));
    }
    const defaultData = {
      recentPlaylists: [],
      accessToken: null,
      refreshToken: null,
      isPremium: false
    };
    fs.writeFileSync(userPath, JSON.stringify(defaultData, null, 2));
    return defaultData;
  } catch (error) {
    console.error('Error reading user data:', error);
    return null;
  }
};

const updateUserData = (userId, data) => {
  const userPath = path.join(__dirname, 'private', 'users', `user-${userId}.json`);
  try {
    fs.writeFileSync(userPath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing user data:', error);
    return false;
  }
};

const reportRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'You can only submit a report 10 times a minute. Please try again later.' },
  keyGenerator: (req) => req.session.userId || req.ip, // Use user ID or IP as key
});

const generateRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 4,
  message: { error: 'You can only generate a playlist 4 times a minute. Please try again later.' },
  keyGenerator: (req) => req.session.userId || req.ip, // Use user ID or IP as key
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize Spotify API
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI || 'https://2bd2d9ce-1ca0-40a9-9a8f-96a476650021-00-29abs2ukh4i2n.picard.replit.dev/callback'
});
async function refreshSpotifyToken(userId) {
    try {
        const userData = getUserData(userId);
        if (!userData || !userData.refreshToken) {
            throw new Error('No refresh token available');
        }

        spotifyApi.setRefreshToken(userData.refreshToken);
        const data = await retrySpotifyOperation(() => spotifyApi.refreshAccessToken());
        userData.accessToken = data.body['access_token'];
        updateUserData(userId, userData);
        spotifyApi.setAccessToken(data.body['access_token']);
        return data.body['access_token'];
    } catch (error) {
        console.error('Error refreshing token:', error);
        throw error;
    }
}

async function checkAndRefreshToken(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    try {
        await refreshSpotifyToken(req.session.userId);
        next();
    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(401).json({ error: 'Authentication failed' });
    }
}
// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Store user's recent playlists

const isBanned = (userId) => {
  return bannedUsers.indexOf(userId) !== -1;
}

// Add these routes to your Express app
app.get('/api/top-artists', async (req, res) => {
    const userId = req.session.userId;
    if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const userData = getUserData(userId);
        spotifyApi.setAccessToken(userData.accessToken);
        const data = await spotifyApi.getMyTopArtists({ limit: 10, time_range: 'medium_term' });
        res.json(data.body);
    } catch (error) {
        console.error('Error fetching top artists:', error);
        res.status(500).json({ error: 'Failed to fetch top artists' });
    }
});

app.get('/api/top-tracks', async (req, res) => {
    const userId = req.session.userId;
    if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const userData = getUserData(userId);
        spotifyApi.setAccessToken(userData.accessToken);
        const data = await spotifyApi.getMyTopTracks({ limit: 10, time_range: 'medium_term' });
        res.json(data.body);
    } catch (error) {
        console.error('Error fetching top tracks:', error);
        res.status(500).json({ error: 'Failed to fetch top tracks' });
    }
});

app.get('/api/search', async (req, res) => {
    try {
        const { type, query } = req.query;
        let results;

        if (type === 'artist') {
            results = await spotifyApi.searchArtists(query, { limit: 5 });
        } else {
            results = await spotifyApi.searchTracks(query, { limit: 5 });
        }

        res.json(results.body);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ error: 'Failed to search' });
    }
});
//
// Routes
//

// login route ---------------------------------------------------------------------
app.get('/login', (req, res) => { 
  const scopes = ['playlist-modify-public', 'user-top-read', 'playlist-modify-private', 'ugc-image-upload'];
  res.redirect(spotifyApi.createAuthorizeURL(scopes));
});

async function refreshAccessToken(userId) {
  const userData = getUserData(userId);
  if (!userData || !userData.refreshToken) {
    throw new Error('No refresh token available');
  }
  try {
    spotifyApi.setRefreshToken(userData.refreshToken);
    const data = await spotifyApi.refreshAccessToken();
    const accessToken = data.body['access_token'];

    userData.accessToken = accessToken;
    spotifyApi.setAccessToken(accessToken);
    updateUserData(userId, userData);
    return accessToken;
  } catch (error) {
    console.error('Error refreshing token:', error);

    //User data deletion on refresh failure.  Consider alternative handling
    //updateUserData(userId, {}); //Clear user data on failure.  Consider more robust error handling.
    throw new Error('Failed to refresh access token');
  }
}
// Add a middleware to check authentication
const checkAuth = async (req, res, next) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.redirect('/login');
  }
  try {
    await refreshAccessToken(userId);
    next();
  } catch (error) {
    // Clear session and redirect to login
    req.session.destroy();
    return res.redirect('/login');
  }
};

// callback route --------------------------------------------------------------
app.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/?error=' + error);
  }
  if (!code) {
    return res.redirect('/?error=no_code');
  }
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const accessToken = data.body['access_token'];
    const refreshToken = data.body['refresh_token'];
    spotifyApi.setAccessToken(accessToken);
    spotifyApi.setRefreshToken(refreshToken);
    const me = await spotifyApi.getMe();
    const userId = me.body.id;
    if (isBanned(userId)) {
      return res.redirect('/?error=user_banned');
    }
    // Store session data
    const userData = {
      accessToken,
      refreshToken,
      recentPlaylists: [],
      isPremium: false // Added isPremium flag to user data
    };
    updateUserData(userId, userData);
    req.session.userId = userId;

    // Redirect to the originally requested URL or dashboard
    const returnTo = req.session.returnTo || '/dashboard';
    delete req.session.returnTo;

    return res.redirect(returnTo);
  } catch (error) {
    console.error('Auth Error:', error);
    return res.redirect('/?error=auth_failed');
  }
});

// generate playlist route --------------------------------------------------
app.post('/api/generate-playlist', generateRateLimiter, async (req, res) => {
  const startTime = Date.now();
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (isBanned(userId)) {
    return res.status(403).json({ error: 'User is banned' });
  }

  const userData = getUserData(userId);
  spotifyApi.setAccessToken(userData.accessToken);

  const { mood, genre, type, familyFriendly } = req.body;
  try {
    await refreshAccessToken(userId);
    const userData = getUserData(userId);
    spotifyApi.setAccessToken(userData.accessToken);
    
    // Check for premium status from user data
    const isPremium = userData.isPremium === true;
    const dailyLimit = isPremium ? Infinity : 3;
    const songsPerPlaylist = isPremium ? 100 : 55;
    console.log("User Premium Status:", isPremium, "Songs Per Playlist:", songsPerPlaylist, "Daily Limit:", dailyLimit);
    
    // Check daily playlist limit for non-premium users
    const today = new Date().toDateString();
    const todayPlaylists = (userData.recentPlaylists || [])
      .filter(p => new Date(p.created).toDateString() === today)
      .length;
      
    if (!isPremium && todayPlaylists >= dailyLimit) {
      return res.status(403).json({ 
        error: 'Daily playlist limit reached',
        details: 'Upgrade to Premium for unlimited playlists'
      });
    }
    // Get user's top tracks
    const topArtists = await spotifyApi.getMyTopArtists();
    artistString = "";
    for (artist in topArtists) {
      artistString = artistString+", "+artist['name'];
    }

    const topTracks = await spotifyApi.getMyTopTracks();
    trackString = "";
    for (track in topTracks) {
      trackString = trackString+", "+track['name'];
    }

    // Create a new playlist
    const playlistResponse = await spotifyApi.createPlaylist(`Generating ${mood} ${genre} Playlist...`, {
      description: `Please wait while Mixee is generating your playlist...`,
      public: false
    });
    if (familyFriendly === undefined) {
        familyFriendly = false; // Default value if not provided
    }
    const familyFriendlyString = familyFriendly ? "\n5. Make sure the playlist if family friendly." : "";

    const playlistId = playlistResponse.body.id;

    // Generate recommendations using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [ 
        {
          role: "system",
            content: `You are a music expert creating a personalized ${type} playlist. Create a playlist that:
            1. Matches the mood: ${mood}
            2. Fits the genre: ${genre}
            3. Considers the user's favorite artists: ${artistString}
            4. Incorporates some of their favorite tracks: ${trackString}${familyFriendlyString}
            Rules:
            - Generate exactly ${songsPerPlaylist} songs for this playlist.
            - Generate songs that blend the requested mood/genre with the user's taste
            - Include some songs from their top artists but also similar artists
            - Format each song as: "Song Title - Artist Name"
            - One song per line
            - Ensure songs are likely to exist on Spotify
            - Don't add numbering or extra text
            - Try to avoid repetitive songs
            - Try to use different songs for each playlist
            - do not put the songs in quotes
            - DO NOT SAY ANYTHING ELSE BESIDES THE LIST OF SONGS
            - MAKE SURE THAT IT FITS THE MOOD AND GENRE`
        }
      ]
    });

    const response = completion.choices[0].message.content;
    const songList = response.split('\n').filter(song => song.trim());
    const tracks = [];
    
    // Search for each song and add to tracks array
    for (const song of songList) {
        const [title, artist] = song.split(' - ').map(s => s.trim());
        try {
            const searchResult = await spotifyApi.searchTracks(`track:${title} artist:${artist}`);
            if (searchResult.body.tracks.items.length > 0) {
                tracks.push(searchResult.body.tracks.items[0].uri);
            }
        } catch (error) {
            console.error(`Error searching for track: ${song}`, error);
        }
    }

    // Add tracks to playlist in batches of 100 (Spotify API limit)
    for (let i = 0; i < tracks.length; i += 100) {
        const batch = tracks.slice(i, i + 100);
        await spotifyApi.addTracksToPlaylist(playlistId, batch);
    }

    // Update playlist details
    await spotifyApi.changePlaylistDetails(playlistId, {
        name: `${mood} ${genre} Playlist`,
        description: `A ${mood} ${genre} playlist created by Mixee`
    });

    // Store playlist info in recent playlists
    const playlistInfo = {
        id: playlistId,
        name: `${mood} ${genre} Playlist`,
        tracks: songList,
        spotifyEmbed: `https://open.spotify.com/embed/playlist/${playlistId}`,
        created: new Date().toISOString()
    };

    // Update recent playlists
    if (!userData.recentPlaylists) {
        userData.recentPlaylists = [];
    }
    userData.recentPlaylists.unshift(playlistInfo);
    if (userData.recentPlaylists.length > 3) {
        userData.recentPlaylists.pop();
    }

    // Generate and upload thumbnail
    const thumbnailGenerator = new PlaylistThumbnailGenerator();
    const thumbnailBuffer = await thumbnailGenerator.generateThumbnail(
        mood,
        genre,
        `${mood} ${genre} Playlist`
    );
    
    await spotifyApi.uploadCustomPlaylistCoverImage(playlistId, thumbnailBuffer.toString('base64'));
    console.log(`Playlist generation completed in ${Date.now() - startTime}ms`);
        
        updateUserData(userId, userData);
        return res.json({
            success: true,
            playlist: playlistResponse.body,
            playlistId: playlistId,
            spotifyEmbed: `https://open.spotify.com/embed/playlist/${playlistId}`,
            recentPlaylists: userData.recentPlaylists
        });
    } catch (error) {
        console.error('Error generating playlist:', error);
        return res.status(500).json({
            error: error.message,
            details: 'Failed to generate or save playlist'
        });
    }
});
app.get('/api/recent-playlists', (req, res) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (isBanned(userId)) {
    return res.status(403).json({ error: 'User is banned' });
  }

  const userData = getUserData(userId);
  res.json({ playlists: userData.recentPlaylists });
});

// recent playlists route ---------------------------------------------
app.get('/api/recent-playlists', (req, res) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (isBanned(userId)) {
    return res.status(403).json({ error: 'User is banned' });
  }

  const userData = getUserData(userId);
  res.json({ playlists: userData.recentPlaylists });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/success', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    
    // Update premium status immediately after successful payment
    const userData = getUserData(req.session.userId);
    if (userData) {
        userData.isPremium = true;
        updateUserData(req.session.userId, userData);
    }
    
    res.sendFile(path.join(__dirname, 'public/html/success.html'));
});

// premium purchase endpoint ---------------------------------------------
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Create payment session endpoint
app.get('/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});

app.post('/api/create-payment-session', async (req, res) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${process.env.DOMAIN}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.DOMAIN}/dashboard`,
      client_reference_id: userId
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error('Stripe session error:', error);
    res.status(500).json({ error: 'Failed to create payment session' });
  }
});

// Stripe webhook endpoint
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id;
    
    try {
      const userData = getUserData(userId);
      if (userData) {
        userData.isPremium = true;
        userData.stripeCustomerId = session.customer;
        userData.premiumPurchaseDate = new Date().toISOString();
        console.log(`Setting premium status for user ${userId}`);
        updateUserData(userId, userData);
      }
    } catch (error) {
      console.error('Error updating premium status:', error);
    }
  }

  res.json({received: true});
});

// report -------------------------------------------------------------

app.post('/api/report-to-staff', reportRateLimiter, (req, res) => {
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (isBanned(userId)) {
    return res.status(403).json({ error: 'User is banned' });
  }

  const message = req.headers.message;
  fs.readFile('private/reports.json', 'utf8', (err, data) => {
      if (err) {
          console.error('Error reading the file:', err);
          return;
      }
      let jsonData = JSON.parse(data);
      jsonData[userId] = message
      const updatedJson = JSON.stringify(jsonData, null, 4); // Pretty-print with 4 spaces
      fs.writeFile('private/reports.json', updatedJson, 'utf8', (err) => {
          if (err) {
              console.error('Error writing the file:', err);
              return;
          }
      });
  });
  res.json({message: message});
});

// main routes --------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'html', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  if (req.session.userId) {
    res.sendFile(path.join(__dirname, 'public', 'html', 'dashboard.html'));
  } else {
    res.redirect('/login');
  }
});

app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', 'html', '404.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});