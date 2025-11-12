import { loadShadersFromURLS, buildProgramFromSources, setupWebGL } from './libs/utils.js';
import * as CUBE from './libs/objects/cube.js';
import * as CYLINDER from './libs/objects/cylinder.js';
import * as SPHERE from './libs/objects/sphere.js';
import * as TORUS from './libs/objects/torus.js';
import { vec3, vec4, mat4, perspective, lookAt, scalem, translate, mult, flatten, radians, rotateX, rotateY, rotateZ, ortho } from './libs/MV.js';
import { loadMatrix, pushMatrix, popMatrix, multMatrix, modelView } from './libs/stack.js';

function findNode(node, name) {
    if (node.name === name) {
        return node;
    }
    for (let child of node.children) {
        let found = findNode(child, name);
        if (found) {
            return found;
        }
    }
    return null;
}

const colorMap = {
    "TANK_BODY_COLOR": vec4(0.2, 0.4, 0.1, 1.0),
    "TANK_CANNON_COLOR": vec4(0.2, 0.2, 0.2, 1.0),
    "TANK_WHEEL_COLOR": vec4(0.1, 0.1, 0.1, 1.0),
    "WIREFRAME_COLOR": vec4(0.0, 0.0, 0.0, 1.0),
    "HEADLIGHT_COLOR": vec4(0.9, 0.9, 0.7, 1.0)
};

const primitiveMap = {
    "CUBE": CUBE,
    "CYLINDER": CYLINDER,
    "SPHERE": SPHERE,
    "TORUS": TORUS
};

function resolveSceneGraph(node) {
    if (node.primitive) {
        node.primitive = primitiveMap[node.primitive];
    }
    if (node.color) {
        node.color = colorMap[node.color];
    }
    for (let child of node.children) {
        resolveSceneGraph(child);
    }
    return node;
}

let gl;
let program;
let uModelViewMatrix;
let uProjectionMatrix;
let uColor;
const colorLightGray = vec4(0.8, 0.8, 0.8, 1.0);
const colorDarkGray = vec4(0.5, 0.5, 0.5, 1.0);

let sceneGraph; 

const tankState = {
    tankPositionZ: 0.0,
    cabinRotationY: 0.0,
    cannonRotationX: 0.0,
    wheelRotation: 0.0, 
    wireframe: false
};

const projectionState = {
    currentView: 0,
    isPerspective: true,
    isOblique: false,
    orthoZoom: 4.0,
    theta: 45.0,
    gamma: 45.0,
};

let tankNodeRef;
let cabinNodeRef;
let cannonNodeRef;
let wheelNodesRef = [];

let tomatoes = [];
const tomatoColor = vec4(1.0, 0.2, 0.2, 1.0);
const gravity = vec3(0.0, -9.8, 0.0);
const initialVelocity = 12.0;
let lastTime = 0;

let targets = [];
const targetColor = vec4(1.0, 0.8, 0.0, 1.0);
const targetRadius = 0.3;
const targetHeight = 1.0;
let score = 0;
const numTargets = 5;

const gameState = {
    isActive: false,
    startTime: 0,
    currentTime: 0,
    bestTime: null
};

async function setup() {
    let canvas = document.getElementById("gl-canvas");
    gl = setupWebGL(canvas, { requestWebGl2: true }); 
    if (!gl) { alert("O WebGL 2 não está disponível!"); return; }

    gl.clearColor(0.53, 0.6, 0.7, 1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.0, 1.0);

    const shaders = await loadShadersFromURLS([
        'shader.vert',
        'shader.frag'
    ]);

    program = buildProgramFromSources(gl, shaders['shader.vert'], shaders['shader.frag']);
    gl.useProgram(program);

    CUBE.init(gl);
    CYLINDER.init(gl);
    SPHERE.init(gl);
    TORUS.init(gl);

    uModelViewMatrix = gl.getUniformLocation(program, "u_model_view");
    uProjectionMatrix = gl.getUniformLocation(program, "u_projection");
    uColor = gl.getUniformLocation(program, "uColor");

    try {
        const response = await fetch('./tank.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const jsonData = await response.json();
        sceneGraph = resolveSceneGraph(jsonData);

    } catch (error) {
        console.error("Falha ao carregar 'tank.json':", error);
        alert("Falha ao carregar o modelo do tanque. Verifica a consola.");
        return;
    }

    tankNodeRef = findNode(sceneGraph, "tank");
    cabinNodeRef = findNode(sceneGraph, "cabin");
    cannonNodeRef = findNode(sceneGraph, "cannon_pivot");
    for (let i = 0; i < 6; i++) {
        wheelNodesRef.push(findNode(sceneGraph, `wheel_L${i}`));
        wheelNodesRef.push(findNode(sceneGraph, `wheel_R${i}`));
    }
    
    loadBestTime();
    
    updateScoreDisplay();
    updateGameUI();
    
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", resizeCanvas);
    canvas.addEventListener("wheel", handleWheel);
    
    setupStartGameButton();
    
    setupEndGameButton();
    
    setupPanelToggle();
    
    resizeCanvas(); 
    render();
}

function uploadModelView() {
    gl.uniformMatrix4fv(uModelViewMatrix, false, flatten(modelView()));
}

function drawWorld(baseMatrix) {
    drawGround(baseMatrix);
    drawSceneGraph(baseMatrix);
    drawTargets(baseMatrix);
    drawTomatoes(baseMatrix);
}

function drawGround(baseMatrix) {
    let size = 10;
    let tileSize = 2.0;
    pushMatrix();
    loadMatrix(baseMatrix); 
    var scaleMatrix = scalem(tileSize, 0.01, tileSize);
    for (let x = -size; x <= size; x++) {
        for (let z = -size; z <= size; z++) {
            var color = (x + z) % 2 === 0 ? colorLightGray : colorDarkGray;
            gl.uniform4fv(uColor, flatten(color)); 
            var translateMatrix = translate(x * tileSize, 0.0, z * tileSize);
            var tileMatrix = mult(translateMatrix, scaleMatrix);
            pushMatrix(); 
            multMatrix(tileMatrix); 
            uploadModelView(); 
            CUBE.draw(gl, program, gl.TRIANGLES); 
            popMatrix(); 
        }
    }
    popMatrix();
}

function drawSceneGraph(baseMatrix) {
    pushMatrix();
    loadMatrix(baseMatrix);
    drawNode(sceneGraph, gl.TRIANGLES); 
    if (tankState.wireframe) {
        drawNode(sceneGraph, gl.LINES);     
    }
    popMatrix();
}

function drawNode(node, mode) {
    pushMatrix();
    let T = translate(node.translateX, node.translateY, node.translateZ);
    let Rz = rotateZ(node.rotateZ);
    let Ry = rotateY(node.rotateY);
    let Rx = rotateX(node.rotateX);
    let S = scalem(node.scaleX, node.scaleY, node.scaleZ);
    let localMatrix = mult(T, mult(Rz, mult(Ry, mult(Rx, S))));
    multMatrix(localMatrix);

    if (node.primitive) {
        if (mode === gl.TRIANGLES) {
            gl.uniform4fv(uColor, flatten(node.color));
        } else {
            gl.uniform4fv(uColor, flatten(colorMap["WIREFRAME_COLOR"]));
        }
        uploadModelView();
        node.primitive.draw(gl, program, mode);
    }
    for (let child of node.children) {
        drawNode(child, mode);
    }
    popMatrix();
}

function updateSceneState() {
    tankNodeRef.translateZ = tankState.tankPositionZ;
    cabinNodeRef.rotateY = tankState.cabinRotationY;
    cannonNodeRef.rotateX = tankState.cannonRotationX;
    
    for (let wheel of wheelNodesRef) {
        wheel.rotateY = tankState.wheelRotation; 
    }
}

function getCannonTipPositionAndDirection() {
    let T_tank = translate(tankNodeRef.translateX, tankNodeRef.translateY, tankNodeRef.translateZ);
    let M = T_tank;
    
    let R_cabin = rotateY(cabinNodeRef.rotateY);
    M = mult(M, R_cabin);
    
    let T_pivot = translate(0, 0.3, 0.8);
    M = mult(M, T_pivot);
    
    let R_cannon = rotateX(cannonNodeRef.rotateX);
    M = mult(M, R_cannon);
    
    let tipLocal = vec4(0, 0.65, 2.2, 1);
    let directionLocal = vec4(0, 0, 1, 0);
    
    let tipWorld = mult(M, tipLocal);
    let dirWorld = mult(M, directionLocal);
    
    let dir = vec3(dirWorld[0], dirWorld[1], dirWorld[2]);
    let length = Math.sqrt(dir[0]*dir[0] + dir[1]*dir[1] + dir[2]*dir[2]);
    if (length > 0) {
        dir = vec3(dir[0]/length, dir[1]/length, dir[2]/length);
    }
    
    return {
        position: vec3(tipWorld[0], tipWorld[1], tipWorld[2]),
        direction: dir
    };
}

function getTankPOV() {
    let T_tank = translate(tankNodeRef.translateX, tankNodeRef.translateY, tankNodeRef.translateZ);
    let M_cabin = T_tank;
    
    let R_cabin = rotateY(cabinNodeRef.rotateY);
    M_cabin = mult(M_cabin, R_cabin);
    
    let cameraLocal = vec4(0, 2.5, -4.0, 1);
    let cameraWorld = mult(M_cabin, cameraLocal);
    let eye = vec3(cameraWorld[0], cameraWorld[1], cameraWorld[2]);
    
    let tankCenterLocal = vec4(0, 0.8, 0, 1);
    let tankCenterWorld = mult(M_cabin, tankCenterLocal);
    let tankCenter = vec3(tankCenterWorld[0], tankCenterWorld[1], tankCenterWorld[2]);
    
    let forwardLocal = vec4(0, 0, 1, 0);
    let forwardWorld = mult(M_cabin, forwardLocal);
    
    let forward = vec3(forwardWorld[0], forwardWorld[1], forwardWorld[2]);
    let length = Math.sqrt(forward[0]*forward[0] + forward[1]*forward[1] + forward[2]*forward[2]);
    if (length > 0) {
        forward = vec3(forward[0]/length, forward[1]/length, forward[2]/length);
    }
    
    let lookAtPos = vec3(
        tankCenter[0] + forward[0] * 3.0,
        tankCenter[1] + forward[1] * 3.0,
        tankCenter[2] + forward[2] * 3.0
    );
    
    return {
        eye: eye,
        at: lookAtPos,
        up: vec3(0.0, 1.0, 0.0)
    };
}

function shootTomato() {
    let cannon = getCannonTipPositionAndDirection();
    
    let tomato = {
        position: cannon.position,
        velocity: vec3(cannon.direction[0] * initialVelocity, 
                      cannon.direction[1] * initialVelocity, 
                      cannon.direction[2] * initialVelocity),
        time: 0.0
    };
    
    tomatoes.push(tomato);
}

function updateTomatoes(dt) {
    for (let i = tomatoes.length - 1; i >= 0; i--) {
        let tomato = tomatoes[i];
        
        tomato.velocity[1] += gravity[1] * dt;
        
        tomato.position[0] += tomato.velocity[0] * dt;
        tomato.position[1] += tomato.velocity[1] * dt;
        tomato.position[2] += tomato.velocity[2] * dt;
        
        tomato.time += dt;
        
        let hitTarget = checkTomatoTargetCollision(tomato);
        
        if (hitTarget || tomato.position[1] < -5.0 || tomato.time > 15.0) {
            tomatoes.splice(i, 1);
        }
    }
}

function drawTomatoes(baseMatrix) {
    pushMatrix();
    loadMatrix(baseMatrix);
    
    for (let tomato of tomatoes) {
        pushMatrix();
        let T = translate(tomato.position[0], tomato.position[1], tomato.position[2]);
        let S = scalem(0.1, 0.1, 0.1);
        multMatrix(mult(T, S));
        
        gl.uniform4fv(uColor, flatten(tomatoColor));
        uploadModelView();
        SPHERE.draw(gl, program, gl.TRIANGLES);
        
        popMatrix();
    }
    
    popMatrix();
}

function generateTargets() {
    targets = [];
    const minDistance = 5.0;
    const maxDistance = 15.0;
    
    for (let i = 0; i < numTargets; i++) {
        const angle = (Math.PI * 2 * i) / numTargets + Math.random() * 0.5;
        const distance = minDistance + Math.random() * (maxDistance - minDistance);
        
        const target = {
            position: vec3(
                Math.cos(angle) * distance,
                targetHeight,
                Math.sin(angle) * distance
            ),
            active: true
        };
        targets.push(target);
    }
}

function startGame() {
    if (gameState.isActive) return;
    
    gameState.isActive = true;
    gameState.startTime = Date.now() / 1000.0;
    gameState.currentTime = 0;
    score = 0;
    tomatoes = [];
    
    generateTargets();
    
    projectionState.currentView = 4;
    projectionState.isPerspective = true;
    
    updateGameUI();
    updateScoreDisplay();
}

function checkGameEnd() {
    if (!gameState.isActive) return;
    
    const activeTargets = targets.filter(t => t.active).length;
    if (activeTargets === 0) {
        endGame();
    }
}

function endGame(shouldSaveBestTime = true) {
    if (!gameState.isActive) return;
    
    gameState.isActive = false;
    gameState.currentTime = Date.now() / 1000.0 - gameState.startTime;
    
    if (shouldSaveBestTime && (gameState.bestTime === null || gameState.currentTime < gameState.bestTime)) {
        gameState.bestTime = gameState.currentTime;
        saveBestTime();
    }
    
    targets = [];
    
    tomatoes = [];
    
    tankState.tankPositionZ = 0.0;
    tankState.cabinRotationY = 0.0;
    tankState.cannonRotationX = 0.0;
    tankState.wheelRotation = 0.0;
    
    updateSceneState();
    
    projectionState.currentView = 1;
    
    updateGameUI();
    updateScoreDisplay();
}

function drawTargets(baseMatrix) {
    pushMatrix();
    loadMatrix(baseMatrix);
    
    for (let target of targets) {
        if (!target.active) continue;
        
        pushMatrix();
        let T = translate(target.position[0], target.position[1], target.position[2]);
        let S = scalem(targetRadius, targetRadius, targetRadius);
        multMatrix(mult(T, S));
        
        gl.uniform4fv(uColor, flatten(targetColor));
        uploadModelView();
        SPHERE.draw(gl, program, gl.TRIANGLES);
        
        popMatrix();
    }
    
    popMatrix();
}

function checkTomatoTargetCollision(tomato) {
    if (!gameState.isActive) return false;
    
    const tomatoRadius = 0.1;
    
    for (let i = 0; i < targets.length; i++) {
        let target = targets[i];
        if (!target.active) continue;
        
        let dx = tomato.position[0] - target.position[0];
        let dy = tomato.position[1] - target.position[1];
        let dz = tomato.position[2] - target.position[2];
        let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (distance < (tomatoRadius + targetRadius)) {
            target.active = false;
            score += 1;
            updateScoreDisplay();
            updateGameUI();
            
            checkGameEnd();
            
            return true;
        }
    }
    return false;
}

function updateScoreDisplay() {
    const scoreElement = document.getElementById("score-display");
    if (scoreElement) {
        if (gameState.isActive) {
            scoreElement.textContent = `Score: ${score}`;
            scoreElement.style.display = "inline-block";
        } else {
            scoreElement.style.display = "none";
        }
    }
}

function updateGameUI() {
    const timerElement = document.getElementById("timer-display");
    if (timerElement) {
        if (gameState.isActive) {
            gameState.currentTime = Date.now() / 1000.0 - gameState.startTime;
            const minutes = Math.floor(gameState.currentTime / 60);
            const seconds = (gameState.currentTime % 60).toFixed(2);
            timerElement.textContent = `Time: ${minutes}:${seconds.padStart(5, '0')}`;
            timerElement.style.display = "inline-block";
        } else {
            timerElement.style.display = "none";
        }
    }
    
    const targetsLeftElement = document.getElementById("targets-left-display");
    if (targetsLeftElement) {
        if (gameState.isActive) {
            const activeTargets = targets.filter(t => t.active).length;
            targetsLeftElement.textContent = `Targets: ${activeTargets}`;
            targetsLeftElement.style.display = "inline-block";
        } else {
            targetsLeftElement.style.display = "none";
        }
    }
    
    const bestTimeElement = document.getElementById("best-time-display");
    if (bestTimeElement) {
        if (gameState.bestTime !== null) {
            const minutes = Math.floor(gameState.bestTime / 60);
            const seconds = (gameState.bestTime % 60).toFixed(2);
            bestTimeElement.textContent = `Best: ${minutes}:${seconds.padStart(5, '0')}`;
            bestTimeElement.style.display = gameState.isActive ? "none" : "inline-block";
        } else {
            bestTimeElement.textContent = "Best: --:--";
            bestTimeElement.style.display = gameState.isActive ? "none" : "inline-block";
        }
    }
    
    const startButton = document.getElementById("start-game-button");
    if (startButton) {
        startButton.style.display = gameState.isActive ? "none" : "block";
    }
    
    const endButton = document.getElementById("end-game-button");
    if (endButton) {
        endButton.style.display = gameState.isActive ? "block" : "none";
    }
}

function loadBestTime() {
    const saved = localStorage.getItem("tankGameBestTime");
    if (saved !== null) {
        gameState.bestTime = parseFloat(saved);
    }
}

function saveBestTime() {
    if (gameState.bestTime !== null) {
        localStorage.setItem("tankGameBestTime", gameState.bestTime.toString());
    }
}

function setupStartGameButton() {
    const startButton = document.getElementById("start-game-button");
    if (startButton) {
        startButton.addEventListener("click", startGame);
    }
}

function setupEndGameButton() {
    const endButton = document.getElementById("end-game-button");
    if (endButton) {
        endButton.addEventListener("click", () => endGame(false));
    }
}

function setupCamera(viewId, aspect) {
    let projectionMatrix;
    let cameraMatrix;
    
    const zoom = projectionState.orthoZoom;
    let eye = vec3(3.0, 3.0, 7.0);
    let at = vec3(0.0, 0.5, 0.0);
    let up = vec3(0.0, 1.0, 0.0);

    switch (viewId) {
        case 1:
            projectionMatrix = ortho(-zoom * aspect, zoom * aspect, -zoom, zoom, -10, 10);
            cameraMatrix = lookAt(vec3(5, 0.5, 0), at, up);
            break;
        case 2:
            projectionMatrix = ortho(-zoom * aspect, zoom * aspect, -zoom, zoom, -10, 10);
            cameraMatrix = lookAt(vec3(0, 0.5, 5), at, up);
            break;
        case 3:
            projectionMatrix = ortho(-zoom * aspect, zoom * aspect, -zoom, zoom, -10, 10);
            cameraMatrix = lookAt(vec3(0, 5, 0.01), at, vec3(-1, 0, 0));
            break;
        case 4:
            if (gameState.isActive) {
                projectionMatrix = perspective(65.0, aspect, 0.1, 100.0);
                const thirdPerson = getTankPOV();
                cameraMatrix = lookAt(thirdPerson.eye, thirdPerson.at, thirdPerson.up);
            } else {
                if (projectionState.isPerspective) {
                    projectionMatrix = perspective(50.0, aspect, 0.1, 100.0);
                    eye = vec3(5, 2, -2);
                    
                } else {
                    if (projectionState.isOblique) {
                        const theta_rad = radians(projectionState.theta);
                        const gamma_rad = radians(projectionState.gamma);
                        let H = mat4();
                        H[0][2] = -0.5 * Math.cos(theta_rad);
                        H[1][2] = -0.5 * Math.sin(theta_rad);
                        projectionMatrix = mult(ortho(-zoom * aspect, zoom * aspect, -zoom, zoom, -100, 100), H);
                    } else {
                        projectionMatrix = ortho(-zoom * aspect, zoom * aspect, -zoom, zoom, -100, 100);
                    }
                }
                
                if (projectionState.isPerspective) {
                     cameraMatrix = lookAt(eye, at, up);
                } else {
                    if (projectionState.isOblique) {
                        cameraMatrix = lookAt(vec3(2, 1.2, 1), at, up);
                    } else {
                        let rotX = rotateX(projectionState.gamma);
                        let rotY = rotateY(projectionState.theta);
                        let eye_initial = vec4(0, 5, 5, 1);
                        let eye_rotated = mult(rotY, mult(rotX, eye_initial));
                        let eye_y = Math.max(eye_rotated[1], 1.0);
                        cameraMatrix = lookAt(vec3(eye_rotated[0], eye_y, eye_rotated[2]), at, up);
                    }
                }
            }
            break;
    }
    
    gl.uniformMatrix4fv(uProjectionMatrix, false, flatten(projectionMatrix));
    
    return cameraMatrix;
}

function render() {
    if (!sceneGraph) {
        requestAnimationFrame(render);
        return;
    }

    let currentTime = Date.now() / 1000.0;
    let dt = lastTime === 0 ? 0.016 : currentTime - lastTime;
    lastTime = currentTime;
    
    updateTomatoes(dt);
    
    updateGameUI();

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    updateSceneState();
    
    const w_full = gl.canvas.width;
    const h_full = gl.canvas.height;
    
    if (gameState.isActive) {
        gl.viewport(0, 0, w_full, h_full);
        let cam = setupCamera(4, w_full / h_full);
        drawWorld(cam);
    } else {
        if (projectionState.currentView === 0) {
            const w = w_full / 2;
            const h = h_full / 2;

            gl.viewport(0, h, w, h);
            let cam1 = setupCamera(1, w / h);
            drawWorld(cam1);

            gl.viewport(w, h, w, h);
            let cam2 = setupCamera(2, w / h);
            drawWorld(cam2);
            
            gl.viewport(0, 0, w, h);
            let cam3 = setupCamera(3, w / h);
            drawWorld(cam3);

            gl.viewport(w, 0, w, h);
            let cam4 = setupCamera(4, w / h);
            drawWorld(cam4);

        } else {
            gl.viewport(0, 0, w_full, h_full);
            let cam = setupCamera(projectionState.currentView, w_full / h_full);
            drawWorld(cam);
        }
    }

    requestAnimationFrame(render);
}

function handleKeyDown(event) {
    const moveStep = 0.1; 
    const rotStep = 5.0;
    const wheelRotStep = 20.0;
    const angleStep = 5.0;

    switch (event.key) {
        case 'q':
            tankState.tankPositionZ += moveStep;
            tankState.wheelRotation += wheelRotStep;
            break;
        case 'e':
            tankState.tankPositionZ -= moveStep;
            tankState.wheelRotation -= wheelRotStep;
            break;
        case 'a':
            tankState.cabinRotationY += rotStep;
            break;
        case 'd':
            tankState.cabinRotationY -= rotStep;
            break;
        case 'w':
            tankState.cannonRotationX = Math.max(tankState.cannonRotationX - rotStep, -60.0); 
            break;
        case 's':
            tankState.cannonRotationX = Math.min(tankState.cannonRotationX + rotStep, 10.0);
            break;
        case " ":
            tankState.wireframe = !tankState.wireframe;
            break;
        case 'h':
            toggleControlPanel();
            break;
        case 'z':
            shootTomato();
            break;

        case '0':
            projectionState.currentView = 0;
            break;
        case '1':
            projectionState.currentView = 1;
            break;
        case '2':
            projectionState.currentView = 2;
            break;
        case '3':
            projectionState.currentView = 3;
            break;
        case '4':
            projectionState.currentView = 4;
            break;
        case '9':
            projectionState.isPerspective = !projectionState.isPerspective;
            break;
        case '8':
            projectionState.isOblique = !projectionState.isOblique;
            break;
        case 'r':
            projectionState.theta = 45.0;
            projectionState.gamma = 45.0;
            projectionState.orthoZoom = 4.0;
            projectionState.isPerspective = true;
            projectionState.isOblique = false;
            break;
        
        case 'ArrowUp':
            projectionState.gamma = Math.min(projectionState.gamma + angleStep, 90.0);
            break;
        case 'ArrowDown':
            projectionState.gamma = Math.max(projectionState.gamma - angleStep, -90.0);
            break;
        case 'ArrowLeft':
            projectionState.theta -= angleStep;
            break;
        case 'ArrowRight':
            projectionState.theta += angleStep;
            break;
    }
}

function handleWheel(event) {
    event.preventDefault();
    
    const zoomSpeed = 0.1;
    if (event.deltaY < 0) {
        projectionState.orthoZoom = Math.max(projectionState.orthoZoom - zoomSpeed, 1.0);
    } else {
        projectionState.orthoZoom += zoomSpeed;
    }
}

function resizeCanvas() {
    gl.canvas.width = gl.canvas.clientWidth;
    gl.canvas.height = gl.canvas.clientHeight;
}

function setupPanelToggle() {
}

function toggleControlPanel() {
    const panel = document.getElementById("control-panel");
    if (panel) {
        panel.style.display = panel.style.display === "none" ? "block" : "none";
    }
}

setup();
