// PlaylistThumbnailGenerator.js
const { createCanvas } = require('canvas');

class PlaylistThumbnailGenerator {
    async generateThumbnail(mood, genre, playlistName) {
        // Create canvas using node-canvas
        const canvas = createCanvas(1000, 1000);
        const ctx = canvas.getContext('2d');

        // Set canvas size
        canvas.width = 1000;
        canvas.height = 1000;

        // Define gradients
        const gradients = {
            'Happy': ['#FFD700', '#FFA500'],
            'Sad': ['#4B0082', '#000080'],
            'Energetic': ['#FF4500', '#FF0000'],
            'Relaxed': ['#4682B4', '#00CED1'],
            'Excited': ['#FF1493', '#FF69B4'],
            'Anxious': ['#20B2AA', '#008B8B'],
            'Curious': ['#48D1CC', '#40E0D0'],
            'Confident': ['#FF4500', '#FF0000'],
            'Bored': ['#4682B4', '#00CED1'],
            'Content': ['#FFD700', '#FFA500'],
            'Frustrated': ['#FF1493', '#FF69B4'],
            'Grateful': ['#20B2AA', '#008B8B'],
            'Nervous': ['#4B0082', '#000080'],
            'Angry': ['#FF0000', '#8B0000'],
            'Hopeful': ['#48D1CC', '#40E0D0'],
            'Romantic': ['#FF69B4', '#DA70D6']
        };

        // Create gradient
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        const colors = gradients[mood] || ['#800080', '#FF1493'];
        gradient.addColorStop(0, colors[0]);
        gradient.addColorStop(1, colors[1]);

        // Fill background
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Add circular element
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.arc(canvas.width/2, canvas.height/2, 300, 0, Math.PI * 2);
        ctx.fill();

        // Text settings
        ctx.textAlign = 'center';
        ctx.fillStyle = 'white';

        // Add text
        ctx.font = 'bold 72px Arial'; // Changed to Arial as it's more widely available
        ctx.fillText(mood, canvas.width/2, canvas.height/2 - 50);

        ctx.font = '48px Arial';
        ctx.fillText(genre, canvas.width/2, canvas.height/2 + 50);

        ctx.font = '36px Arial';
        ctx.fillText('Created by Mixee', canvas.width/2, canvas.height - 120);

        ctx.font = '24px Arial';
        ctx.fillText('For Spotify', canvas.width/2, canvas.height - 60);

        // Return as buffer instead of DataURL for Node.js
        return canvas.toBuffer('image/jpeg', { quality: 0.95 });
    }
}

module.exports = PlaylistThumbnailGenerator;