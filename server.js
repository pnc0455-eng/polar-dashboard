const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration placeholders - You will replace these later when deploying
const DISCORD_CLIENT_ID = '1532988574583226538';
const DISCORD_CLIENT_SECRET = 'qSX44vleIXgec44EU24bfuimfolc8Ron';
const CALLBACK_URL = 'https://polar-dashboard-1.onrender.com/auth/discord/callback';
const YOUR_GUILD_ID = '1507403006357016698'; 
const BLOXLINK_API_KEY = 'YOUR_BLOXLINK_API_KEY';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

app.use(session({
    secret: 'polar-secure-session',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// Set up Discord OAuth2
passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ['identify', 'guilds', 'guilds.members.read']
}, async (accessToken, refreshToken, profile, done) => {
    return done(null, { profile, accessToken });
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// Routes
app.get('/', (req, res) => {
    res.render('login');
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/'
}), (req, res) => res.redirect('/dashboard'));

app.get('/dashboard', async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/');

    const user = req.user.profile;
    const accessToken = req.user.accessToken;
    
    let robloxData = null;
    let joinedAt = 'Unknown';

    try {
        const bloxlinkRes = await axios.get(`https://api.blox.link/v4/public/guilds/${YOUR_GUILD_ID}/discord-to-roblox/${user.id}`, {
            headers: { 'Authorization': BLOXLINK_API_KEY }
        });
        
        if (bloxlinkRes.data && bloxlinkRes.data.robloxID) {
            robloxData = { username: "RobloxUser123", displayName: "CoolPlayer" }; 
        }

        const guildMemberRes = await axios.get(`https://discord.com/api/users/@me/guilds/${YOUR_GUILD_ID}/member`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        joinedAt = new Date(guildMemberRes.data.joined_at).toLocaleDateString();

    } catch (err) {
        console.log("Could not fetch external API data");
    }

    res.render('dashboard', {
        user: user,
        avatarUrl: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`,
        roblox: robloxData,
        createdAt: new Date(Number((BigInt(user.id) >> 22n) + 1420070400000n)).toLocaleDateString(),
        joinedAt: joinedAt,
        lastVisit: new Date().toLocaleTimeString()
    });
});

app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
