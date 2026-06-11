const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false }); // Optimize for no transparency on base

// UI Elements
const uiScore = document.getElementById('score-display');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const startBtn = document.getElementById('start-btn');
const resetBtn = document.getElementById('reset-btn');
const finalTimeEl = document.getElementById('final-time');
const finalCoinsEl = document.getElementById('final-coins');
const finalScoreEl = document.getElementById('final-score');
const bestScoreEl = document.getElementById('best-score');

// Game State
let currentState = 'START'; // START, PLAYING, GAMEOVER
let bestScore = 0;
let frames = 0;
let startTime = 0;
let aliveTime = 0;
let score = 0;
let coinsCollected = 0;

// Difficulty scaling
let baseSpeed = 3;
let currentSpeed = baseSpeed;
let pipeGap = 200;
let minPipeGap = 120;
let framesBetweenPipes = 150;
let minFramesBetweenPipes = 80;

// Handle resizing
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// --- IMAGE LOADING & PROCESSING ---
const images = {};
let imagesLoaded = 0;
const totalImages = 4;

function processImage(img, removeWhite) {
    if (!removeWhite) return img;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    tempCtx.drawImage(img, 0, 0);
    
    try {
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            // Check for white/near-white pixels
            if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230) {
                data[i + 3] = 0; // Set alpha to 0
            }
        }
        tempCtx.putImageData(imageData, 0, 0);
        const newImg = new Image();
        newImg.src = tempCanvas.toDataURL();
        return newImg;
    } catch (e) {
        console.warn("Could not process image due to CORS/Tainted Canvas, using original.", e);
        return img;
    }
}

function loadImage(name, src, removeWhite = false) {
    const img = new Image();
    img.src = src;
    img.onload = () => {
        images[name] = processImage(img, removeWhite);
        imagesLoaded++;
        if (imagesLoaded === totalImages) {
            init(); // Start loop when all loaded
        }
    };
    img.onerror = () => {
        console.error("Failed to load image:", src);
        // Fallback: Just count it as loaded to not block the game completely
        imagesLoaded++;
        if (imagesLoaded === totalImages) init();
    };
}

loadImage('bg', 'assets/bg.png', false);
loadImage('bird', 'assets/bird.png', true);
loadImage('pipe', 'assets/pipe.png', true);
loadImage('coin', 'assets/coin.png', true);

// --- GAME OBJECTS ---

const background = {
    x: 0,
    draw: function() {
        if (!images.bg) return;
        // Parallax effect
        let ratio = canvas.height / images.bg.height;
        let w = images.bg.width * ratio;
        
        // Loop enough times to cover canvas width plus 2*w
        let totalW = 0;
        let count = 0;
        while (this.x + totalW < canvas.width + w) {
            if (count % 2 === 0) {
                // Normal
                ctx.drawImage(images.bg, this.x + totalW, 0, w, canvas.height);
            } else {
                // Flipped horizontally to make the edge perfectly seamless
                ctx.save();
                ctx.translate(this.x + totalW + w, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(images.bg, 0, 0, w, canvas.height);
                ctx.restore();
            }
            totalW += w;
            count++;
        }
        
        if (currentState === 'PLAYING') {
            this.x -= (currentSpeed * 0.5); // Slower than pipes
            // Since pattern repeats every 2 images, wrap safely
            if (this.x <= -2 * w) this.x += 2 * w;
        }
    }
};

const bird = {
    x: 50,
    y: 150,
    width: 60,
    height: 40,
    velocity: 0,
    gravity: 0.2,   // Reduced gravity for smoother fall
    jump: -5.5,     // Reduced jump force for smoother flap
    rotation: 0,
    radius: 15, // For collision

    draw: function() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        
        // Wing flapping simulation
        let flapScale = 1;
        // Flap rapidly when moving up or slightly down
        if (this.velocity < 2 && currentState === 'PLAYING') {
            flapScale = 1 + 0.25 * Math.sin(frames * 0.8);
        } else if (currentState === 'START') {
            flapScale = 1 + 0.15 * Math.sin(frames * 0.3); // Gentle hover flap
        }
        ctx.scale(1, flapScale);
        
        if (images.bird) {
            // Flip the bird horizontally so it faces right (forward)
            ctx.save();
            ctx.scale(-1, 1);
            ctx.drawImage(images.bird, -this.width / 2, -this.height / 2, this.width, this.height);
            ctx.restore();
        } else {
            // Fallback
            ctx.fillStyle = "yellow";
            ctx.beginPath();
            ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
    },

    update: function() {
        this.velocity += this.gravity;
        this.y += this.velocity;

        // Smooth rotation based on velocity
        let targetRotation = (this.velocity * 4) * Math.PI / 180;
        // Clamp between -25 and +90 degrees
        targetRotation = Math.max(-25 * Math.PI / 180, Math.min(Math.PI / 2, targetRotation));
        // Smoothly interpolate current rotation to target rotation
        this.rotation += (targetRotation - this.rotation) * 0.15;

        // Floor collision
        if (this.y + this.height / 2 >= canvas.height) {
            this.y = canvas.height - this.height / 2;
            gameOver();
        }
        // Ceiling collision
        if (this.y - this.height / 2 <= 0) {
            this.y = this.height / 2;
            this.velocity = 0;
        }
    },
    
    flap: function() {
        this.velocity = this.jump;
    },
    
    reset: function() {
        this.y = canvas.height / 2;
        this.velocity = 0;
        this.rotation = 0;
    }
};

const pipes = {
    items: [],
    width: 80,
    
    draw: function() {
        for (let i = 0; i < this.items.length; i++) {
            let p = this.items[i];
            
            if (images.pipe) {
                // Top Pipe (draw flipped or just top part)
                ctx.save();
                ctx.translate(p.x + this.width / 2, p.y);
                ctx.scale(1, -1); // Flip vertically for top pipe
                ctx.drawImage(images.pipe, -this.width / 2, 0, this.width, 800); // 800 is arbitrary large number to fill screen
                ctx.restore();
                
                // Bottom Pipe
                ctx.drawImage(images.pipe, p.x, p.y + p.gap, this.width, canvas.height - (p.y + p.gap));
            } else {
                // Fallback
                ctx.fillStyle = "#2ecc71";
                // Top
                ctx.fillRect(p.x, 0, this.width, p.y);
                // Bottom
                ctx.fillRect(p.x, p.y + p.gap, this.width, canvas.height - (p.y + p.gap));
            }
        }
    },
    
    update: function() {
        // Spawning logic
        if (frames % Math.floor(framesBetweenPipes) === 0) {
            // Calculate a random y position for the gap
            // Ensure gap is neither too high nor too low
            const gapPosition = Math.random() * (canvas.height - pipeGap - 100) + 50;
            
            // Complex level logic: pipes move after 20 seconds of aliveTime
            let isMoving = aliveTime > 20; 
            let moveSpeed = isMoving ? (Math.random() > 0.5 ? 1 : -1) * (1 + (aliveTime - 20) * 0.05) : 0;
            // Cap move speed
            if (moveSpeed > 3) moveSpeed = 3;
            if (moveSpeed < -3) moveSpeed = -3;
            
            this.items.push({
                x: canvas.width,
                y: gapPosition,
                gap: pipeGap,
                passed: false,
                isMoving: isMoving,
                moveDirection: moveSpeed,
                minY: Math.max(50, gapPosition - 100),
                maxY: Math.min(canvas.height - pipeGap - 50, gapPosition + 100)
            });
        }
        
        for (let i = 0; i < this.items.length; i++) {
            let p = this.items[i];
            
            // Move horizontally
            p.x -= currentSpeed;
            
            // Move vertically for complex levels
            if (p.isMoving) {
                p.y += p.moveDirection;
                if (p.y < p.minY || p.y > p.maxY) {
                    p.moveDirection *= -1; // Reverse direction
                }
            }
            
            // Collision Detection
            // Fix: make the hitbox significantly smaller so transparent parts don't kill the bird
            let birdLeft = bird.x - bird.width/2 + 20;
            let birdRight = bird.x + bird.width/2 - 20;
            let birdTop = bird.y - bird.height/2 + 15;
            let birdBottom = bird.y + bird.height/2 - 15;
            
            let pipeLeft = p.x;
            let pipeRight = p.x + this.width;
            
            // Hit Top Pipe
            if (birdRight > pipeLeft && birdLeft < pipeRight && birdTop < p.y) {
                gameOver();
            }
            // Hit Bottom Pipe
            if (birdRight > pipeLeft && birdLeft < pipeRight && birdBottom > p.y + p.gap) {
                gameOver();
            }
            
            // Remove off-screen pipes
            if (p.x + this.width < 0) {
                this.items.shift();
                i--;
            }
        }
    },
    
    reset: function() {
        this.items = [];
    }
};

const coins = {
    items: [],
    width: 40,
    height: 40,
    
    draw: function() {
        for (let i = 0; i < this.items.length; i++) {
            let c = this.items[i];
            
            if (images.coin) {
                ctx.save();
                ctx.translate(c.x + this.width/2, c.y + this.height/2);
                // 3D spin effect using cosine scale
                let spin = Math.cos(frames * 0.1); 
                ctx.scale(spin, 1);
                ctx.drawImage(images.coin, -this.width/2, -this.height/2, this.width, this.height);
                ctx.restore();
            } else {
                ctx.fillStyle = "gold";
                ctx.beginPath();
                ctx.arc(c.x + this.width/2, c.y + this.height/2, this.width/2, 0, Math.PI*2);
                ctx.fill();
            }
        }
    },
    
    update: function() {
        // Spawn coins in the middle of pipes
        if (frames % Math.floor(framesBetweenPipes) === 0) {
            // Need to get the last spawned pipe's properties to put coin in it
            if (pipes.items.length > 0) {
                let lastPipe = pipes.items[pipes.items.length - 1];
                this.items.push({
                    x: lastPipe.x + pipes.width / 2 - this.width / 2,
                    pipe: lastPipe
                });
            }
        }
        
        for (let i = 0; i < this.items.length; i++) {
            let c = this.items[i];
            c.x -= currentSpeed;
            // Coin moves vertically with the moving pipe
            c.y = c.pipe.y + c.pipe.gap / 2 - this.height / 2;
            
            // Collision Detection with bird
            let birdLeft = bird.x - bird.width/2;
            let birdRight = bird.x + bird.width/2;
            let birdTop = bird.y - bird.height/2;
            let birdBottom = bird.y + bird.height/2;
            
            if (birdRight > c.x && birdLeft < c.x + this.width &&
                birdBottom > c.y && birdTop < c.y + this.height) {
                // Collect coin
                coinsCollected++;
                uiScore.classList.remove('score-pop');
                void uiScore.offsetWidth; // Trigger reflow
                uiScore.classList.add('score-pop');
                this.items.splice(i, 1);
                i--;
                continue;
            }
            
            if (c.x + this.width < 0) {
                this.items.splice(i, 1);
                i--;
            }
        }
    },
    
    reset: function() {
        this.items = [];
    }
};

// --- GAME LOGIC ---

function gameOver() {
    if (currentState === 'GAMEOVER') return;
    currentState = 'GAMEOVER';
    
    // Calculate final score
    const finalScore = Math.floor(aliveTime) + (coinsCollected * 10);
    if (finalScore > bestScore) {
        bestScore = finalScore;
    }
    
    finalTimeEl.innerText = aliveTime.toFixed(1);
    finalCoinsEl.innerText = coinsCollected;
    finalScoreEl.innerText = finalScore;
    bestScoreEl.innerText = bestScore;
    
    uiScore.style.opacity = 0; // Hide in-game score
    gameOverScreen.classList.add('active');
}

function resetGame() {
    bird.reset();
    pipes.reset();
    coins.reset();
    frames = 0;
    coinsCollected = 0;
    aliveTime = 0;
    score = 0;
    
    // Reset Difficulty
    currentSpeed = baseSpeed;
    pipeGap = 200;
    framesBetweenPipes = 150;
    
    uiScore.innerText = "0";
    uiScore.style.opacity = 1;
    gameOverScreen.classList.remove('active');
    startScreen.classList.remove('active');
    currentState = 'PLAYING';
    startTime = Date.now();
}

function flap() {
    if (currentState === 'PLAYING') {
        bird.flap();
    } else if (currentState === 'START') {
        resetGame();
    }
}

// --- INPUT EVENTS ---
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') flap();
});

window.addEventListener('mousedown', (e) => {
    if (e.target !== startBtn && e.target !== resetBtn) {
        flap();
    }
});

window.addEventListener('touchstart', (e) => {
    if (e.target !== startBtn && e.target !== resetBtn) {
        flap();
    }
}, {passive: false});

startBtn.addEventListener('click', resetGame);
resetBtn.addEventListener('click', resetGame);

// --- MAIN LOOP ---

function draw() {
    // Clear canvas by drawing sky color (in case bg image fails or has transparent parts)
    ctx.fillStyle = "#4ec0ca";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    background.draw();
    
    if (currentState === 'PLAYING') {
        pipes.draw();
        coins.draw();
        bird.draw();
    } else if (currentState === 'START' || currentState === 'GAMEOVER') {
        bird.draw();
    }
}

function update() {
    if (currentState === 'PLAYING') {
        // Time and Difficulty scaling
        let now = Date.now();
        aliveTime = (now - startTime) / 1000; // in seconds
        
        // Increase speed slowly
        currentSpeed = baseSpeed + (aliveTime * 0.05);
        if (currentSpeed > 8) currentSpeed = 8;
        
        // Decrease gap slowly
        pipeGap = 200 - (aliveTime * 1.5);
        if (pipeGap < minPipeGap) pipeGap = minPipeGap;
        
        // Adjust spawn rate based on speed to keep distances somewhat consistent
        framesBetweenPipes = 150 * (baseSpeed / currentSpeed);
        if (framesBetweenPipes < minFramesBetweenPipes) framesBetweenPipes = minFramesBetweenPipes;
        
        score = Math.floor(aliveTime) + (coinsCollected * 10);
        uiScore.innerText = score;
        
        bird.update();
        pipes.update();
        coins.update();
        frames++;
    }
}

function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

function init() {
    // Called once images are loaded
    startScreen.classList.add('active');
    loop();
}

// Fallback if images fail completely
setTimeout(() => {
    if (imagesLoaded < totalImages && currentState === 'START') {
        console.log("Images taking too long, forcing start");
        init();
    }
}, 3000);
