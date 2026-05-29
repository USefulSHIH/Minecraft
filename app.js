/**
 * Antigravity-Craft (Minecraft Browser Edition)
 * High-performance voxel engine using Three.js InstancedMesh
 */

// --- CONFIGURATION ---
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 64;
const RENDER_DISTANCE = 3; // In chunks
const BLOCK_SIZE = 1;

// Block Types
const BLOCKS = {
    AIR: 0,
    GRASS: 1,
    DIRT: 2,
    STONE: 3,
    WOOD: 4,
    LEAVES: 5,
    BEDROCK: 6
};

const BLOCK_DATA = {
    [BLOCKS.GRASS]: { name: "Grass Block", color: 0x55aa55, sideColor: 0x8B5A2B },
    [BLOCKS.DIRT]: { name: "Dirt", color: 0x8B5A2B },
    [BLOCKS.STONE]: { name: "Stone", color: 0x888888 },
    [BLOCKS.WOOD]: { name: "Oak Log", color: 0x6b4226, sideColor: 0x4a2e1b },
    [BLOCKS.LEAVES]: { name: "Oak Leaves", color: 0x228b22, transparent: true },
    [BLOCKS.BEDROCK]: { name: "Bedrock", color: 0x222222 }
};

// --- GAME STATE ---
let gameMode = 'SURVIVAL'; // SURVIVAL or CREATIVE
let isAntigravity = false;
let inventory = {
    [BLOCKS.GRASS]: 10,
    [BLOCKS.DIRT]: 20,
    [BLOCKS.STONE]: 0,
    [BLOCKS.WOOD]: 0,
    [BLOCKS.LEAVES]: 0
}; // Item counts
let hotbarSlots = [BLOCKS.GRASS, BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.WOOD, BLOCKS.LEAVES, BLOCKS.AIR];
let activeSlotIndex = 0;

// --- THREE.JS SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue
scene.fog = new THREE.Fog(0x87CEEB, 20, RENDER_DISTANCE * CHUNK_SIZE);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(50, 100, 50);
scene.add(dirLight);

// --- PROCEDURAL TEXTURE GENERATION ---
function generateTexture(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const data = BLOCK_DATA[type];
    
    ctx.fillStyle = '#' + (data.color || 0xffffff).toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, 64, 64);
    
    // Add noise for texture
    for(let i=0; i<400; i++) {
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';
        ctx.fillRect(Math.random()*64, Math.random()*64, 2, 2);
    }

    if (type === BLOCKS.GRASS) {
        ctx.fillStyle = '#44aa44';
        for(let i=0; i<100; i++) ctx.fillRect(Math.random()*64, Math.random()*64, 3, 3);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
}

const materials = {};
for(let key in BLOCKS) {
    if(BLOCKS[key] === BLOCKS.AIR) continue;
    materials[BLOCKS[key]] = new THREE.MeshLambertMaterial({
        map: generateTexture(BLOCKS[key]),
        transparent: BLOCK_DATA[BLOCKS[key]].transparent || false,
        opacity: BLOCK_DATA[BLOCKS[key]].transparent ? 0.9 : 1.0
    });
}

// --- WORLD GENERATION (3D SIMPLEX NOISE) ---
const simplex = new SimplexNoise();
const chunks = new Map(); // key: "x,z", value: Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE)
const chunkMeshes = new Map(); // key: "x,z", value: THREE.Group

function getChunkKey(cx, cz) { return `${cx},${cz}`; }

function noise3D(x, y, z) {
    // Fractal Brownian Motion
    let total = 0;
    let frequency = 0.03;
    let amplitude = 1;
    let maxValue = 0;
    for(let i=0; i<3; i++) {
        total += simplex.noise3D(x * frequency, y * frequency, z * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    return total / maxValue;
}

function generateChunk(cx, cz) {
    const data = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    
    for(let x=0; x<CHUNK_SIZE; x++) {
        for(let z=0; z<CHUNK_SIZE; z++) {
            const worldX = cx * CHUNK_SIZE + x;
            const worldZ = cz * CHUNK_SIZE + z;
            
            // 2D Heightmap for base terrain
            const baseHeight = Math.floor(20 + simplex.noise2D(worldX * 0.02, worldZ * 0.02) * 10);
            
            for(let y=0; y<CHUNK_HEIGHT; y++) {
                const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_HEIGHT;
                
                if (y === 0) {
                    data[index] = BLOCKS.BEDROCK;
                } else if (y < baseHeight) {
                    // 3D Noise for caves and overhangs
                    const density = noise3D(worldX, y, worldZ);
                    if (density > -0.2) {
                        if (y === baseHeight - 1) data[index] = BLOCKS.GRASS;
                        else if (y > baseHeight - 4) data[index] = BLOCKS.DIRT;
                        else data[index] = BLOCKS.STONE;
                    } else {
                        data[index] = BLOCKS.AIR;
                    }
                } else if (y === baseHeight && Math.random() < 0.01) {
                    // Generate tree
                    data[index] = BLOCKS.WOOD;
                    if(y+1 < CHUNK_HEIGHT) data[index + CHUNK_SIZE] = BLOCKS.WOOD;
                    if(y+2 < CHUNK_HEIGHT) data[index + CHUNK_SIZE*2] = BLOCKS.LEAVES;
                } else {
                    data[index] = BLOCKS.AIR;
                }
            }
        }
    }
    return data;
}

function buildChunkMesh(cx, cz) {
    const key = getChunkKey(cx, cz);
    const data = chunks.get(key);
    if (!data) return;

    if (chunkMeshes.has(key)) {
        scene.remove(chunkMeshes.get(key));
        chunkMeshes.delete(key);
    }

    const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    const group = new THREE.Group();

    // Group blocks by type for InstancedMesh
    const blockCounts = {};
    for(let i=0; i<data.length; i++) {
        if(data[i] !== BLOCKS.AIR) {
            blockCounts[data[i]] = (blockCounts[data[i]] || 0) + 1;
        }
    }

    const instancedMeshes = {};
    const matrices = {};
    const dummy = new THREE.Object3D();

    for(let type in blockCounts) {
        const count = blockCounts[type];
        const mesh = new THREE.InstancedMesh(geometry, materials[type], count);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        instancedMeshes[type] = mesh;
        matrices[type] = 0;
        group.add(mesh);
    }

    for(let x=0; x<CHUNK_SIZE; x++) {
        for(let z=0; z<CHUNK_SIZE; z++) {
            for(let y=0; y<CHUNK_HEIGHT; y++) {
                const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_HEIGHT;
                const type = data[index];
                if (type !== BLOCKS.AIR) {
                    // Basic face culling (check if surrounded)
                    let visible = false;
                    if (x===0||x===CHUNK_SIZE-1 || y===0||y===CHUNK_HEIGHT-1 || z===0||z===CHUNK_SIZE-1) visible = true;
                    else {
                        if (data[index - 1] === BLOCKS.AIR) visible = true; // left
                        else if (data[index + 1] === BLOCKS.AIR) visible = true; // right
                        else if (data[index - CHUNK_SIZE] === BLOCKS.AIR) visible = true; // down
                        else if (data[index + CHUNK_SIZE] === BLOCKS.AIR) visible = true; // up
                        else if (data[index - CHUNK_SIZE*CHUNK_HEIGHT] === BLOCKS.AIR) visible = true; // back
                        else if (data[index + CHUNK_SIZE*CHUNK_HEIGHT] === BLOCKS.AIR) visible = true; // front
                    }

                    if (visible) {
                        dummy.position.set(cx * CHUNK_SIZE + x, y, cz * CHUNK_SIZE + z);
                        dummy.updateMatrix();
                        const im = instancedMeshes[type];
                        const mIndex = matrices[type];
                        im.setMatrixAt(mIndex, dummy.matrix);
                        matrices[type]++;
                    }
                }
            }
        }
    }

    // Update instance counts to actual visible count
    for(let type in instancedMeshes) {
        instancedMeshes[type].count = matrices[type];
        instancedMeshes[type].instanceMatrix.needsUpdate = true;
    }

    chunkMeshes.set(key, group);
    scene.add(group);
}

function updateChunks() {
    const px = Math.floor(camera.position.x / CHUNK_SIZE);
    const pz = Math.floor(camera.position.z / CHUNK_SIZE);

    for (let cx = px - RENDER_DISTANCE; cx <= px + RENDER_DISTANCE; cx++) {
        for (let cz = pz - RENDER_DISTANCE; cz <= pz + RENDER_DISTANCE; cz++) {
            const key = getChunkKey(cx, cz);
            if (!chunks.has(key)) {
                chunks.set(key, generateChunk(cx, cz));
                buildChunkMesh(cx, cz);
            }
        }
    }
}

// --- PHYSICS & LOCOMOTION ---
const player = {
    x: 8, y: 30, z: 8, // Center of chunk 0,0
    width: 0.6, height: 1.8,
    vx: 0, vy: 0, vz: 0,
    speed: 5, jumpPower: 7, gravity: 20,
    onGround: false
};
camera.position.set(player.x, player.y, player.z);

const keys = { w:false, a:false, s:false, d:false, space:false, shift:false };

document.addEventListener('keydown', e => {
    if(e.code === 'KeyW') keys.w = true;
    if(e.code === 'KeyA') keys.a = true;
    if(e.code === 'KeyS') keys.s = true;
    if(e.code === 'KeyD') keys.d = true;
    if(e.code === 'Space') keys.space = true;
    if(e.code === 'ShiftLeft') keys.shift = true;
});
document.addEventListener('keyup', e => {
    if(e.code === 'KeyW') keys.w = false;
    if(e.code === 'KeyA') keys.a = false;
    if(e.code === 'KeyS') keys.s = false;
    if(e.code === 'KeyD') keys.d = false;
    if(e.code === 'Space') keys.space = false;
    if(e.code === 'ShiftLeft') keys.shift = false;
    
    // UI Toggles
    if(e.code === 'KeyG' && document.pointerLockElement === document.body) {
        if(gameMode === 'CREATIVE') {
            isAntigravity = !isAntigravity;
            updateInventoryUI();
        }
    }
    if(e.code === 'KeyM' && document.pointerLockElement === document.body) {
        gameMode = gameMode === 'SURVIVAL' ? 'CREATIVE' : 'SURVIVAL';
        if(gameMode === 'SURVIVAL') isAntigravity = false;
        updateInventoryUI();
    }
    if(e.code === 'KeyE') {
        if (document.pointerLockElement === document.body) {
            document.exitPointerLock();
            document.getElementById('inventory-screen').classList.remove('hidden');
            renderInventoryGrid();
        } else {
            document.getElementById('inventory-screen').classList.add('hidden');
            document.body.requestPointerLock();
        }
    }

    // Hotbar selection
    if(e.code >= 'Digit1' && e.code <= 'Digit6') {
        activeSlotIndex = parseInt(e.key) - 1;
        updateInventoryUI();
    }
});

// Mouse look
let pitch = 0; let yaw = 0;
document.addEventListener('mousemove', e => {
    if(document.pointerLockElement === document.body) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, pitch));
        
        camera.rotation.order = 'YXZ';
        camera.rotation.y = yaw;
        camera.rotation.x = pitch;
    }
});

document.addEventListener('wheel', e => {
    if(document.pointerLockElement === document.body) {
        if(e.deltaY > 0) activeSlotIndex = (activeSlotIndex + 1) % 6;
        else activeSlotIndex = (activeSlotIndex - 1 + 6) % 6;
        updateInventoryUI();
    }
});

function getBlockAt(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if(y < 0 || y >= CHUNK_HEIGHT) return BLOCKS.AIR;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = getChunkKey(cx, cz);
    if(!chunks.has(key)) return BLOCKS.AIR;
    
    const bx = x - cx * CHUNK_SIZE;
    const bz = z - cz * CHUNK_SIZE;
    const index = bx + y * CHUNK_SIZE + bz * CHUNK_SIZE * CHUNK_HEIGHT;
    return chunks.get(key)[index];
}

function setBlockAt(x, y, z, type) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if(y < 0 || y >= CHUNK_HEIGHT) return;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = getChunkKey(cx, cz);
    if(!chunks.has(key)) return;
    
    const bx = x - cx * CHUNK_SIZE;
    const bz = z - cz * CHUNK_SIZE;
    const index = bx + y * CHUNK_SIZE + bz * CHUNK_SIZE * CHUNK_HEIGHT;
    chunks.get(key)[index] = type;
    buildChunkMesh(cx, cz);
    // Update neighbors if on edge
    if(bx===0) buildChunkMesh(cx-1, cz);
    if(bx===CHUNK_SIZE-1) buildChunkMesh(cx+1, cz);
    if(bz===0) buildChunkMesh(cx, cz-1);
    if(bz===CHUNK_SIZE-1) buildChunkMesh(cx, cz+1);
}

function checkCollision(x, y, z) {
    // Check AABB corners
    const pad = 0.2;
    for(let dx of [-pad, pad]) {
        for(let dy of [0, player.height * 0.8]) {
            for(let dz of [-pad, pad]) {
                if(getBlockAt(x + dx, y + dy, z + dz) !== BLOCKS.AIR) return true;
            }
        }
    }
    return false;
}

function updatePhysics(dt) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0,1,0)).normalize();
    
    let moveSpeed = player.speed;
    if(keys.shift && isAntigravity) moveSpeed *= 2;

    if(keys.w) { player.vx = dir.x * moveSpeed; player.vz = dir.z * moveSpeed; }
    else if(keys.s) { player.vx = -dir.x * moveSpeed; player.vz = -dir.z * moveSpeed; }
    else { player.vx = 0; player.vz = 0; }
    
    if(keys.d) { player.vx += right.x * moveSpeed; player.vz += right.z * moveSpeed; }
    else if(keys.a) { player.vx -= right.x * moveSpeed; player.vz -= right.z * moveSpeed; }

    // X collision
    if (!checkCollision(player.x + player.vx * dt, player.y, player.z)) {
        player.x += player.vx * dt;
    }

    // Z collision
    if (!checkCollision(player.x, player.y, player.z + player.vz * dt)) {
        player.z += player.vz * dt;
    }

    // Y collision & Gravity
    if(isAntigravity) {
        player.vy = 0;
        if(keys.space) player.vy = moveSpeed;
        if(keys.shift) player.vy = -moveSpeed;
        if (!checkCollision(player.x, player.y + player.vy * dt, player.z)) {
            player.y += player.vy * dt;
        }
    } else {
        player.vy -= player.gravity * dt;
        if (!checkCollision(player.x, player.y + player.vy * dt, player.z)) {
            player.y += player.vy * dt;
            player.onGround = false;
        } else {
            if (player.vy < 0) player.onGround = true;
            player.vy = 0;
            // Snap to grid slightly to avoid sinking
            player.y = Math.round(player.y * 100) / 100;
        }

        if(keys.space && player.onGround) {
            player.vy = player.jumpPower;
            player.onGround = false;
        }
    }

    camera.position.set(player.x, player.y + player.height, player.z);
}

// --- RAYCASTING (Mining & Placing) ---
const raycaster = new THREE.Raycaster();
document.addEventListener('mousedown', e => {
    if(document.pointerLockElement !== document.body) return;
    
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(Array.from(chunkMeshes.values()), true);
    
    if(intersects.length > 0) {
        const hit = intersects[0];
        if(hit.distance > 5) return; // Reach distance

        const p = hit.point;
        const n = hit.face.normal;

        if(e.button === 0) {
            // Left click: Mine
            // Move slightly inside the block to get correct grid coordinates
            const bx = Math.floor(p.x - n.x * 0.1);
            const by = Math.floor(p.y - n.y * 0.1);
            const bz = Math.floor(p.z - n.z * 0.1);
            
            const minedType = getBlockAt(bx, by, bz);
            if(minedType !== BLOCKS.AIR && minedType !== BLOCKS.BEDROCK) {
                setBlockAt(bx, by, bz, BLOCKS.AIR);
                if(gameMode === 'SURVIVAL') {
                    inventory[minedType] = (inventory[minedType] || 0) + 1;
                    updateInventoryUI();
                }
            }
        } 
        else if(e.button === 2) {
            // Right click: Place
            const activeBlock = hotbarSlots[activeSlotIndex];
            if(activeBlock !== BLOCKS.AIR) {
                if(gameMode === 'SURVIVAL' && (inventory[activeBlock] || 0) <= 0) return; // Out of items

                // Move slightly outside to place
                const bx = Math.floor(p.x + n.x * 0.1);
                const by = Math.floor(p.y + n.y * 0.1);
                const bz = Math.floor(p.z + n.z * 0.1);
                
                // Prevent placing inside player
                if(Math.floor(player.x) === bx && (Math.floor(player.y) === by || Math.floor(player.y+1) === by) && Math.floor(player.z) === bz) return;

                setBlockAt(bx, by, bz, activeBlock);
                if(gameMode === 'SURVIVAL') {
                    inventory[activeBlock]--;
                    updateInventoryUI();
                }
            }
        }
    }
});

// --- UI & INVENTORY LOGIC ---
const blocker = document.getElementById('blocker');
const menu = document.getElementById('menu');
menu.addEventListener('click', () => {
    document.body.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
    if(document.pointerLockElement === document.body) {
        blocker.style.display = 'none';
    } else {
        blocker.style.display = 'flex';
    }
});

function getTextureDataURL(type) {
    if(type === BLOCKS.AIR) return '';
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#' + BLOCK_DATA[type].color.toString(16).padStart(6, '0');
    ctx.fillRect(0,0,16,16);
    return canvas.toDataURL();
}

function updateInventoryUI() {
    const hotbarEl = document.getElementById('hotbar');
    hotbarEl.innerHTML = '';
    
    for(let i=0; i<6; i++) {
        const type = hotbarSlots[i];
        const slotEl = document.createElement('div');
        slotEl.className = 'hotbar-slot' + (i === activeSlotIndex ? ' active' : '');
        slotEl.innerHTML = `<span class="slot-number">${i+1}</span>`;
        
        if(type !== BLOCKS.AIR) {
            slotEl.innerHTML += `<img src="${getTextureDataURL(type)}" alt="block">`;
            const count = gameMode === 'CREATIVE' ? '∞' : (inventory[type] || 0);
            slotEl.innerHTML += `<span class="item-count">${count}</span>`;
        }
        hotbarEl.appendChild(slotEl);
    }

    document.getElementById('game-mode-label').innerText = `Mode: ${gameMode}`;
    document.getElementById('antigravity-label').innerText = `Antigravity: ${isAntigravity ? 'ON' : 'OFF'} (G)`;
}

function renderInventoryGrid() {
    const gridEl = document.getElementById('inventory-grid');
    gridEl.innerHTML = '';
    for(let key in BLOCKS) {
        if(BLOCKS[key] === BLOCKS.AIR) continue;
        const type = BLOCKS[key];
        
        const count = gameMode === 'CREATIVE' ? '∞' : (inventory[type] || 0);
        if(gameMode === 'SURVIVAL' && count === 0) continue;

        const itemEl = document.createElement('div');
        itemEl.className = 'inventory-item';
        itemEl.innerHTML = `<img src="${getTextureDataURL(type)}" alt="block"><span class="item-count">${count}</span>`;
        
        itemEl.onclick = () => {
            hotbarSlots[activeSlotIndex] = type;
            updateInventoryUI();
        };
        gridEl.appendChild(itemEl);
    }
}

// --- MAIN LOOP ---
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    
    if(document.pointerLockElement === document.body) {
        const dt = Math.min(clock.getDelta(), 0.1);
        updatePhysics(dt);
        updateChunks();
    } else {
        clock.getDelta(); // clear delta
    }
    
    renderer.render(scene, camera);
}

// Init
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Force generate initial chunk at 0,0
updateChunks();
updateInventoryUI();
animate();
