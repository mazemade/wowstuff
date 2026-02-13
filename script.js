// Game constants
const YARDS_TO_PIXELS = 8; // 1 yard = 8 pixels for visualization
const REQUIRED_SPACING = 18; // yards
const MAX_RAIDERS = 25;
const MAP_SIZE = 800;
const MAP_CENTER = 400;
const DEFAULT_MAP_UNDERLAY = 'GruulLairMap.png';
const MAP_UNDERLAY_STORAGE_KEY = 'gruulMapUnderlayImage';

// State
let raiders = [];
let positions = [];
let currentFilter = 'all';
let currentImportFormat = 'csv';
let maxArenaRadius = 45; // yards - adjustable by user
let arenaBoundary = null; // Array of {x, y} points defining the arena boundary
let isDrawingBoundary = false;
let isDragging = false;
let drawingPoints = []; // Points collected during freehand drawing

// Check if a point is inside a polygon using ray casting algorithm
function pointInPolygon(point, polygon) {
    if (!polygon || polygon.length < 3) return true; // No boundary = allow all
    
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        
        const intersect = ((yi > point.y) !== (yj > point.y)) &&
                         (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Find the maximum safe radius that fits within the boundary
function findMaxRadiusInBoundary(polygon) {
    if (!polygon || polygon.length < 3) return 60; // Default if no boundary
    
    let maxRadius = 0;
    const center = { x: MAP_CENTER, y: MAP_CENTER };
    
    // Test radii from 10 to 60 yards
    for (let testRadius = 10; testRadius <= 60; testRadius += 1) {
        const testYards = testRadius;
        const testPixels = testYards * YARDS_TO_PIXELS;
        
        // Test 16 points around the circle
        let allInside = true;
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
            const testX = center.x + testPixels * Math.cos(angle);
            const testY = center.y + testPixels * Math.sin(angle);
            
            if (!pointInPolygon({ x: testX, y: testY }, polygon)) {
                allInside = false;
                break;
            }
        }
        
        if (allInside) {
            maxRadius = testYards;
        } else {
            break;
        }
    }
    
    return Math.max(maxRadius, 20); // Minimum 20 yards
}

// Find the closest point inside the boundary from a given point
function findClosestPointInBoundary(point, polygon) {
    if (!polygon || polygon.length < 3) return point;
    if (pointInPolygon(point, polygon)) return point;
    
    // Try moving toward center
    const center = { x: MAP_CENTER, y: MAP_CENTER };
    let bestPoint = point;
    let bestDist = Infinity;
    
    // Try multiple points along the line from point to center
    for (let t = 0.1; t <= 1.0; t += 0.1) {
        const testX = point.x + (center.x - point.x) * t;
        const testY = point.y + (center.y - point.y) * t;
        const testPoint = { x: testX, y: testY };
        
        if (pointInPolygon(testPoint, polygon)) {
            const dist = Math.sqrt((testX - point.x) ** 2 + (testY - point.y) ** 2);
            if (dist < bestDist) {
                bestDist = dist;
                bestPoint = testPoint;
            }
        }
    }
    
    return bestPoint;
}

// Find optimal position within boundary using spiral search
function findOptimalPositionInBoundary(targetAngle, targetRadius, polygon, existingPositions) {
    if (!polygon || polygon.length < 3) {
        return {
            x: MAP_CENTER + targetRadius * Math.cos(targetAngle),
            y: MAP_CENTER + targetRadius * Math.sin(targetAngle)
        };
    }
    
    const center = { x: MAP_CENTER, y: MAP_CENTER };
    let bestPos = null;
    let bestScore = -Infinity;
    const minSpacing = REQUIRED_SPACING * YARDS_TO_PIXELS;
    
    // Try positions at different radii around the target angle
    for (let radiusOffset = 0; radiusOffset <= targetRadius * 0.5; radiusOffset += 10) {
        for (let angleOffset = -Math.PI / 8; angleOffset <= Math.PI / 8; angleOffset += Math.PI / 16) {
            const testRadius = Math.max(20, targetRadius - radiusOffset);
            const testAngle = targetAngle + angleOffset;
            const testX = center.x + testRadius * Math.cos(testAngle);
            const testY = center.y + testRadius * Math.sin(testAngle);
            const testPoint = { x: testX, y: testY };
            
            if (!pointInPolygon(testPoint, polygon)) continue;
            
            // Check spacing from existing positions
            let tooClose = false;
            for (const existing of existingPositions) {
                const dist = Math.sqrt((testX - existing.x) ** 2 + (testY - existing.y) ** 2);
                if (dist < minSpacing * 0.8) {
                    tooClose = true;
                    break;
                }
            }
            if (tooClose) continue;
            
            // Score: prefer positions closer to target, but not too close to others
            const distFromTarget = Math.sqrt((testX - (center.x + targetRadius * Math.cos(targetAngle))) ** 2 +
                                            (testY - (center.y + targetRadius * Math.sin(targetAngle))) ** 2);
            const minDistToOthers = existingPositions.length > 0 
                ? Math.min(...existingPositions.map(p => 
                    Math.sqrt((testX - p.x) ** 2 + (testY - p.y) ** 2)))
                : Infinity;
            
            const score = -distFromTarget + Math.min(minDistToOthers, minSpacing * 2) * 0.1;
            
            if (score > bestScore) {
                bestScore = score;
                bestPos = testPoint;
            }
        }
    }
    
    // Fallback: find closest point in boundary
    if (!bestPos) {
        const fallbackPoint = {
            x: center.x + targetRadius * Math.cos(targetAngle),
            y: center.y + targetRadius * Math.sin(targetAngle)
        };
        bestPos = findClosestPointInBoundary(fallbackPoint, polygon);
    }
    
    return bestPos;
}

// Position generation - Create 25 positions around Gruul with 18-yard spacing
function generatePositions() {
    positions = [];
    
    // If boundary is defined, use it to constrain positions
    let effectiveMaxRadius = maxArenaRadius;
    if (arenaBoundary && arenaBoundary.length >= 3) {
        effectiveMaxRadius = findMaxRadiusInBoundary(arenaBoundary);
    }
    
    // Calculate ring radii based on effective max radius
    const innerRadius = Math.min(12, effectiveMaxRadius * 0.27);
    const middleRadius = Math.min(30, effectiveMaxRadius * 0.67);
    const outerRadius = Math.min(45, effectiveMaxRadius * 0.95);
    
    // Define position layout - circular pattern around the boss
    const positionConfigs = [
        { count: 8, radius: innerRadius * YARDS_TO_PIXELS, preferredRole: 'melee' },
        { count: 9, radius: middleRadius * YARDS_TO_PIXELS, preferredRole: 'ranged' },
        { count: 8, radius: outerRadius * YARDS_TO_PIXELS, preferredRole: 'ranged' }
    ];
    
    let posId = 1;
    
    positionConfigs.forEach(config => {
        const angleStep = (2 * Math.PI) / config.count;
        for (let i = 0; i < config.count; i++) {
            const angle = i * angleStep;
            const targetRadius = config.radius;
            
            let position;
            if (arenaBoundary && arenaBoundary.length >= 3) {
                // Use optimized search to find best position within boundary
                position = findOptimalPositionInBoundary(angle, targetRadius, arenaBoundary, positions);
            } else {
                position = {
                    x: MAP_CENTER + targetRadius * Math.cos(angle),
                    y: MAP_CENTER + targetRadius * Math.sin(angle)
                };
            }
            
            positions.push({
                id: posId++,
                x: position.x,
                y: position.y,
                preferredRole: config.preferredRole,
                assignedRaider: null
            });
        }
    });
}

// Initialize the application
function init() {
    generatePositions();
    setupEventListeners();
    initializeMapUnderlay();
    renderMap();
    renderRaiderList();
    updateRaiderCount();
}

// Event listeners
function setupEventListeners() {
    // Manual add
    document.getElementById('manualAddBtn').addEventListener('click', () => {
        document.getElementById('manualAddForm').style.display = 'block';
        document.getElementById('bulkImportForm').style.display = 'none';
    });
    
    document.getElementById('cancelAddBtn').addEventListener('click', () => {
        document.getElementById('manualAddForm').style.display = 'none';
        document.getElementById('raiderName').value = '';
    });
    
    document.getElementById('addRaiderBtn').addEventListener('click', addRaider);
    
    // Bulk import
    document.getElementById('bulkImportBtn').addEventListener('click', () => {
        document.getElementById('bulkImportForm').style.display = 'block';
        document.getElementById('manualAddForm').style.display = 'none';
    });
    
    document.getElementById('cancelImportBtn').addEventListener('click', () => {
        document.getElementById('bulkImportForm').style.display = 'none';
    });
    
    document.getElementById('importBtn').addEventListener('click', bulkImport);
    
    // Other actions
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);
    document.getElementById('autoAssignBtn').addEventListener('click', autoAssign);
    document.getElementById('clearAssignmentsBtn').addEventListener('click', clearAssignments);
    document.getElementById('exportBtn').addEventListener('click', exportSetup);
    document.getElementById('generateShareLinkBtn').addEventListener('click', generateShareLink);
    
    // Filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.role;
            renderRaiderList();
        });
    });
    
    // Map controls
    document.getElementById('showGridLines').addEventListener('change', (e) => {
        document.getElementById('gridLines').style.display = e.target.checked ? 'block' : 'none';
    });
    
    document.getElementById('showRoleColors').addEventListener('change', () => {
        renderMap();
    });

    document.getElementById('showMapUnderlay').addEventListener('change', toggleMapUnderlayVisibility);
    document.getElementById('uploadMapBtn').addEventListener('click', () => {
        document.getElementById('mapImageInput').click();
    });
    document.getElementById('mapImageInput').addEventListener('change', handleMapImageUpload);
    
    // Arena boundary is now auto-detected from map image (white border)
    // Load saved boundary from localStorage if exists
    const savedBoundary = localStorage.getItem('gruulArenaBoundary');
    if (savedBoundary) {
        try {
            arenaBoundary = JSON.parse(savedBoundary);
            if (arenaBoundary && arenaBoundary.length >= 3) {
                updateBoundaryDisplay();
                regeneratePositions();
            }
        } catch (e) {
            console.error('Failed to load saved boundary:', e);
        }
    }
    
    // Enter key support
    document.getElementById('raiderName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addRaider();
    });
    
    // Format tabs
    document.querySelectorAll('.format-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.format-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentImportFormat = e.target.dataset.format;
            
            // Hide all help texts
            document.querySelectorAll('.format-help').forEach(help => help.style.display = 'none');
            
            // Show relevant help
            if (currentImportFormat === 'csv') {
                document.getElementById('csvFormatHelp').style.display = 'block';
                document.getElementById('bulkImportText').placeholder = 'Example:\nTankadin,tank\nHolypally,healer\nRogue1,melee\nMage1,ranged';
            } else if (currentImportFormat === 'addon') {
                document.getElementById('addonFormatHelp').style.display = 'block';
                document.getElementById('bulkImportText').placeholder = 'Paste the export from /gruulpos addon here...';
            } else if (currentImportFormat === 'names') {
                document.getElementById('namesFormatHelp').style.display = 'block';
                document.getElementById('bulkImportText').placeholder = 'Example:\nTankadin\nHolypally\nRogue1\nMage1';
            }
        });
    });
    
    // Addon info modal
    document.getElementById('showAddonInfoBtn').addEventListener('click', () => {
        document.getElementById('addonInfoModal').style.display = 'flex';
    });
    
    document.querySelector('.close-modal').addEventListener('click', () => {
        document.getElementById('addonInfoModal').style.display = 'none';
    });
    
    // Close modal when clicking outside
    document.getElementById('addonInfoModal').addEventListener('click', (e) => {
        if (e.target.id === 'addonInfoModal') {
            document.getElementById('addonInfoModal').style.display = 'none';
        }
    });
}

function initializeMapUnderlay() {
    const savedMap = localStorage.getItem(MAP_UNDERLAY_STORAGE_KEY);

    if (savedMap) {
        setMapUnderlay(savedMap, true);
        return;
    }

    // Try to load a local default image if it exists in the project.
    setMapUnderlay(DEFAULT_MAP_UNDERLAY, false);
}

// Detect white border from map image and create boundary
function detectWhiteBorderFromMap(image) {
    return new Promise((resolve, reject) => {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = image.naturalWidth || image.width;
            canvas.height = image.naturalHeight || image.height;
            
            ctx.drawImage(image, 0, 0);
            
            // Check for CORS issues
            try {
                ctx.getImageData(0, 0, 1, 1);
            } catch (e) {
                // CORS issue - use fallback ellipse
                console.log('CORS issue with image, using ellipse fallback');
                resolve(createEllipseBoundary(400, 400, 320, 280));
                return;
            }
            
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Scale to our SVG coordinate system (800x800)
            const scaleX = 800 / canvas.width;
            const scaleY = 800 / canvas.height;
            
            // Find white border pixels (thick white line)
            // White: high red, green, blue (all > 200)
            const borderPoints = [];
            const step = 2; // Sample every 2 pixels for accuracy
            
            for (let y = 0; y < canvas.height; y += step) {
                for (let x = 0; x < canvas.width; x += step) {
                    const idx = (y * canvas.width + x) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];
                    const a = data[idx + 3];
                    
                    // Detect white border: very high RGB values (white line)
                    // White border: r > 240, g > 240, b > 240 (almost pure white)
                    if (r > 240 && g > 240 && b > 240 && a > 200) {
                        const svgX = x * scaleX;
                        const svgY = y * scaleY;
                        borderPoints.push({ x: svgX, y: svgY });
                    }
                }
            }
            
            // Create boundary from white border points
            if (borderPoints.length > 100) {
                const boundary = createBoundaryFromBorderPoints(borderPoints);
                resolve(boundary);
            } else {
                // Fallback: use ellipse approximation
                resolve(createEllipseBoundary(400, 400, 320, 280));
            }
        } catch (error) {
            console.error('Error detecting white border:', error);
            // Fallback to ellipse
            resolve(createEllipseBoundary(400, 400, 320, 280));
        }
    });
}

// Create boundary polygon from border points (find inner boundary)
function createBoundaryFromBorderPoints(borderPoints) {
    if (borderPoints.length < 3) {
        return createEllipseBoundary(400, 400, 320, 280);
    }
    
    // Find the center of the border points
    let sumX = 0, sumY = 0;
    borderPoints.forEach(p => {
        sumX += p.x;
        sumY += p.y;
    });
    const centerX = sumX / borderPoints.length;
    const centerY = sumY / borderPoints.length;
    
    // Sort points by angle from center to create a polygon
    const sortedPoints = borderPoints
        .map(p => ({
            x: p.x,
            y: p.y,
            angle: Math.atan2(p.y - centerY, p.x - centerX),
            dist: Math.sqrt((p.x - centerX) ** 2 + (p.y - centerY) ** 2)
        }))
        .sort((a, b) => a.angle - b.angle);
    
    // Group by angle and take the closest point to center for each angle (inner boundary)
    const angleGroups = {};
    sortedPoints.forEach(p => {
        const angleKey = Math.round(p.angle * 100) / 100; // Round to 2 decimals
        if (!angleGroups[angleKey] || p.dist < angleGroups[angleKey].dist) {
            angleGroups[angleKey] = p;
        }
    });
    
    // Convert back to array and create polygon
    const boundaryPoints = Object.values(angleGroups)
        .sort((a, b) => a.angle - b.angle)
        .map(p => ({ x: p.x, y: p.y }));
    
    // Simplify: remove points that are too close together
    const simplified = [];
    const minDist = 10;
    for (let i = 0; i < boundaryPoints.length; i++) {
        const prev = simplified[simplified.length - 1];
        const curr = boundaryPoints[i];
        if (!prev || Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2) >= minDist) {
            simplified.push(curr);
        }
    }
    
    return simplified.length >= 3 ? simplified : createEllipseBoundary(400, 400, 320, 280);
}

// Create ellipse boundary (fallback)
function createEllipseBoundary(centerX, centerY, width, height) {
    const points = [];
    const numPoints = 40; // Smooth ellipse
    
    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        const x = centerX + (width / 2) * Math.cos(angle);
        const y = centerY + (height / 2) * Math.sin(angle);
        points.push({ x, y });
    }
    
    return points;
}

function setMapUnderlay(src, persist) {
    const underlay = document.getElementById('mapUnderlay');
    const dimmer = document.getElementById('mapUnderlayDimmer');

    underlay.onload = async () => {
        if (persist) {
            localStorage.setItem(MAP_UNDERLAY_STORAGE_KEY, src);
        }
        
        // Auto-detect white border from map image
        if (underlay.complete && underlay.naturalWidth > 0) {
            try {
                const detectedBoundary = await detectWhiteBorderFromMap(underlay);
                arenaBoundary = detectedBoundary;
                localStorage.setItem('gruulArenaBoundary', JSON.stringify(arenaBoundary));
                updateBoundaryDisplay();
                regeneratePositions();
            } catch (e) {
                console.error('Error detecting white border:', e);
                // Fallback to ellipse
                arenaBoundary = createEllipseBoundary(400, 400, 320, 280);
                updateBoundaryDisplay();
                regeneratePositions();
            }
        }
        
        toggleMapUnderlayVisibility();
    };

    underlay.onerror = () => {
        // If no default image exists yet, keep the map usable with plain background.
        underlay.style.display = 'none';
        dimmer.style.display = 'none';
    };

    underlay.src = src;
}

function toggleMapUnderlayVisibility() {
    const showUnderlay = document.getElementById('showMapUnderlay').checked;
    const underlay = document.getElementById('mapUnderlay');
    const dimmer = document.getElementById('mapUnderlayDimmer');
    const hasImage = underlay.complete && underlay.naturalWidth > 0;

    underlay.style.display = showUnderlay && hasImage ? 'block' : 'none';
    dimmer.style.display = showUnderlay && hasImage ? 'block' : 'none';
}

function handleMapImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
        const dataUrl = loadEvent.target.result;
        setMapUnderlay(dataUrl, true);
    };
    reader.readAsDataURL(file);

    // Allow selecting the same file again later.
    event.target.value = '';
}

// Add a single raider
function addRaider() {
    const nameInput = document.getElementById('raiderName');
    const roleSelect = document.getElementById('raiderRole');
    
    const name = nameInput.value.trim();
    const role = roleSelect.value;
    
    if (!name) {
        alert('Please enter a raider name');
        return;
    }
    
    if (raiders.length >= MAX_RAIDERS) {
        alert(`Maximum ${MAX_RAIDERS} raiders allowed`);
        return;
    }
    
    raiders.push({
        id: Date.now(),
        name: name,
        role: role,
        position: null
    });
    
    nameInput.value = '';
    document.getElementById('manualAddForm').style.display = 'none';
    
    renderRaiderList();
    updateRaiderCount();
}

// Bulk import raiders
function bulkImport() {
    const text = document.getElementById('bulkImportText').value.trim();
    
    if (!text) {
        alert('Please enter raider data');
        return;
    }
    
    const lines = text.split('\n');
    let imported = 0;
    
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        
        let name, role;
        
        if (currentImportFormat === 'names') {
            // Names only format
            name = trimmed;
            role = document.getElementById('defaultRole').value;
        } else {
            // CSV or addon format (both use comma separation)
            const parts = trimmed.split(',');
            if (parts.length !== 2) {
                console.warn(`Invalid line format: ${line}`);
                return;
            }
            
            name = parts[0].trim();
            role = parts[1].trim().toLowerCase();
        }
        
        if (!['tank', 'healer', 'melee', 'ranged'].includes(role)) {
            console.warn(`Invalid role for ${name}: ${role}`);
            return;
        }
        
        if (raiders.length >= MAX_RAIDERS) {
            console.warn('Max raiders reached');
            return;
        }
        
        raiders.push({
            id: Date.now() + imported,
            name: name,
            role: role,
            position: null
        });
        
        imported++;
    });
    
    document.getElementById('bulkImportText').value = '';
    document.getElementById('bulkImportForm').style.display = 'none';
    
    alert(`Imported ${imported} raiders`);
    renderRaiderList();
    updateRaiderCount();
}

// Clear all raiders
function clearAll() {
    if (raiders.length === 0) return;
    
    if (confirm('Are you sure you want to clear all raiders?')) {
        raiders = [];
        positions.forEach(pos => pos.assignedRaider = null);
        renderRaiderList();
        renderMap();
        updateRaiderCount();
    }
}

// Auto-assign raiders to positions
function autoAssign() {
    if (raiders.length === 0) {
        alert('No raiders to assign');
        return;
    }
    
    // Clear existing assignments
    positions.forEach(pos => pos.assignedRaider = null);
    raiders.forEach(raider => raider.position = null);
    
    // Group raiders by role
    const raidersByRole = {
        tank: raiders.filter(r => r.role === 'tank'),
        healer: raiders.filter(r => r.role === 'healer'),
        melee: raiders.filter(r => r.role === 'melee'),
        ranged: raiders.filter(r => r.role === 'ranged')
    };
    
    // Assign tanks and melee to inner ring (prefer melee positions)
    const meleePositions = positions.filter(p => p.preferredRole === 'melee');
    const rangedPositions = positions.filter(p => p.preferredRole === 'ranged');
    
    let availableMelee = [...meleePositions];
    let availableRanged = [...rangedPositions];
    
    // Assign melee DPS first to melee positions
    raidersByRole.melee.forEach(raider => {
        if (availableMelee.length > 0) {
            const pos = availableMelee.shift();
            assignRaiderToPosition(raider, pos);
        } else if (availableRanged.length > 0) {
            const pos = availableRanged.shift();
            assignRaiderToPosition(raider, pos);
        }
    });
    
    // Assign tanks to remaining melee positions
    raidersByRole.tank.forEach(raider => {
        if (availableMelee.length > 0) {
            const pos = availableMelee.shift();
            assignRaiderToPosition(raider, pos);
        } else if (availableRanged.length > 0) {
            const pos = availableRanged.shift();
            assignRaiderToPosition(raider, pos);
        }
    });
    
    // Assign ranged and healers to ranged positions
    [...raidersByRole.ranged, ...raidersByRole.healer].forEach(raider => {
        if (availableRanged.length > 0) {
            const pos = availableRanged.shift();
            assignRaiderToPosition(raider, pos);
        } else if (availableMelee.length > 0) {
            const pos = availableMelee.shift();
            assignRaiderToPosition(raider, pos);
        }
    });
    
    renderRaiderList();
    renderMap();
}

// Assign a raider to a position
function assignRaiderToPosition(raider, position) {
    raider.position = position.id;
    position.assignedRaider = raider.id;
}

// Clear all assignments
function clearAssignments() {
    if (confirm('Clear all position assignments?')) {
        positions.forEach(pos => pos.assignedRaider = null);
        raiders.forEach(raider => raider.position = null);
        renderRaiderList();
        renderMap();
    }
}

// Export setup
function exportSetup() {
    const setup = {
        raiders: raiders,
        positions: positions,
        timestamp: new Date().toISOString()
    };
    
    const dataStr = JSON.stringify(setup, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gruul-setup.json';
    link.click();
    
    URL.revokeObjectURL(url);
}

// Generate shareable link for view-only mode with URL shortening
async function generateShareLink() {
    if (raiders.length === 0) {
        alert('Please add raiders and assign positions before generating a share link.');
        return;
    }
    
    // Disable button and show loading state
    const shareBtn = document.getElementById('generateShareLinkBtn');
    const originalText = shareBtn.textContent;
    shareBtn.disabled = true;
    shareBtn.textContent = 'Generating...';
    
    try {
        const setup = {
            raiders: raiders,
            positions: positions,
            timestamp: new Date().toISOString()
        };
        
        // Encode to base64
        const jsonStr = JSON.stringify(setup);
        const encoded = btoa(unescape(encodeURIComponent(jsonStr)));
        
        // Create the full share URL
        let baseUrl = window.location.origin;
        let path = window.location.pathname;
        
        // Remove index.html if present, or just use directory
        if (path.endsWith('index.html')) {
            path = path.replace('index.html', '');
        } else if (!path.endsWith('/')) {
            path = path.substring(0, path.lastIndexOf('/') + 1);
        }
        
        const fullUrl = `${baseUrl}${path}view.html?data=${encoded}`;
        
        // Try to shorten the URL (skip for localhost as most services don't accept it)
        let finalUrl = fullUrl;
        const isLocalhost = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
        
        if (!isLocalhost) {
            try {
                // Use v.gd API (handles longer URLs better than is.gd)
                const formData = new URLSearchParams();
                formData.append('url', fullUrl);
                formData.append('format', 'json');
                
                let response = await fetch('https://v.gd/create.php', {
                    method: 'POST',
                    body: formData
                });
                
                // If POST fails, try GET
                if (!response.ok) {
                    const getUrl = `https://v.gd/create.php?format=json&url=${encodeURIComponent(fullUrl)}`;
                    response = await fetch(getUrl);
                }
                
                if (response.ok) {
                    const data = await response.json();
                    console.log('API Response:', data);
                    
                    if (data.shorturl) {
                        finalUrl = data.shorturl;
                        console.log('Using shortened URL:', finalUrl);
                    } else if (data.errorcode) {
                        console.warn('v.gd API error:', data.errormessage);
                        // If v.gd fails, try tinyurl as backup
                        try {
                            const tinyUrlResponse = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(fullUrl)}`);
                            if (tinyUrlResponse.ok) {
                                const tinyUrl = await tinyUrlResponse.text();
                                if (tinyUrl && !tinyUrl.includes('Error') && tinyUrl.startsWith('http')) {
                                    finalUrl = tinyUrl.trim();
                                    console.log('Using TinyURL shortened URL:', finalUrl);
                                }
                            }
                        } catch (tinyError) {
                            console.warn('TinyURL also failed:', tinyError);
                        }
                    }
                } else {
                    console.warn('API request failed:', response.status, response.statusText);
                }
            } catch (apiError) {
                console.error('URL shortening API error:', apiError);
                console.warn('Using full URL as fallback');
            }
        } else {
            console.log('Skipping URL shortening for localhost (most services don\'t accept localhost URLs)');
        }
        
        // Copy to clipboard
        const wasShortened = finalUrl !== fullUrl;
        const urlMessage = wasShortened 
            ? `Shortened link copied to clipboard!\n\n${finalUrl}\n\nShare this link with your raiders so they can see their positions.`
            : `Share link copied to clipboard!\n\nNote: URL shortening failed, using full URL.\n\n${finalUrl}\n\nShare this link with your raiders so they can see their positions.`;
        
        try {
            await navigator.clipboard.writeText(finalUrl);
            alert(urlMessage);
        } catch (clipboardError) {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = finalUrl;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                alert(`Share link copied to clipboard!\n\n${finalUrl}\n\nShare this link with your raiders so they can see their positions.`);
            } catch (e) {
                prompt('Copy this link to share with your raiders:', finalUrl);
            }
            document.body.removeChild(textarea);
        }
    } catch (error) {
        console.error('Error generating share link:', error);
        alert('Error generating share link. Please try again.');
    } finally {
        // Restore button state
        shareBtn.disabled = false;
        shareBtn.textContent = originalText;
    }
}

// Convert SVG coordinates from mouse event
function getSVGCoordinates(event) {
    const svg = document.getElementById('gruulMap');
    const svgPoint = svg.createSVGPoint();
    svgPoint.x = event.clientX;
    svgPoint.y = event.clientY;
    const ctm = svg.getScreenCTM();
    return svgPoint.matrixTransform(ctm.inverse());
}

// Simplify path by removing points that are too close together
function simplifyPath(points, minDistance = 3) {
    if (points.length < 3) return points;
    
    const simplified = [points[0]];
    for (let i = 1; i < points.length; i++) {
        const prev = simplified[simplified.length - 1];
        const curr = points[i];
        const dist = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2);
        if (dist >= minDistance) {
            simplified.push(curr);
        }
    }
    return simplified;
}

// Drawing boundary functions
function startDrawingBoundary() {
    isDrawingBoundary = true;
    isDragging = false;
    drawingPoints = [];
    arenaBoundary = null;
    
    document.getElementById('gruulMap').classList.add('drawing-mode');
    document.getElementById('startDrawingBtn').style.display = 'none';
    document.getElementById('finishDrawingBtn').style.display = 'inline-block';
    document.getElementById('clearBoundaryBtn').style.display = 'inline-block';
    document.getElementById('drawingInstructions').style.display = 'block';
    document.getElementById('drawingPath').style.display = 'block';
    
    const svg = document.getElementById('gruulMap');
    svg.addEventListener('mousedown', handleDrawingStart);
    svg.addEventListener('mousemove', handleDrawingMove);
    svg.addEventListener('mouseup', handleDrawingEnd);
    svg.addEventListener('mouseleave', handleDrawingEnd);
    
    updateBoundaryDisplay();
}

function handleDrawingStart(event) {
    if (!isDrawingBoundary) return;
    isDragging = true;
    drawingPoints = [];
    
    const coords = getSVGCoordinates(event);
    drawingPoints.push({ x: coords.x, y: coords.y });
    updateDrawingPath();
}

function handleDrawingMove(event) {
    if (!isDrawingBoundary || !isDragging) return;
    
    const coords = getSVGCoordinates(event);
    drawingPoints.push({ x: coords.x, y: coords.y });
    updateDrawingPath();
}

function handleDrawingEnd(event) {
    if (!isDrawingBoundary || !isDragging) return;
    
    isDragging = false;
    
    if (drawingPoints.length < 10) {
        alert('Please draw a longer path to define the boundary.');
        drawingPoints = [];
        updateDrawingPath();
        return;
    }
    
    // Simplify and close the path
    const simplified = simplifyPath(drawingPoints, 2);
    if (simplified.length < 3) {
        alert('Please draw a longer path to define the boundary.');
        drawingPoints = [];
        updateDrawingPath();
        return;
    }
    
    // Close the path by connecting last point to first
    arenaBoundary = [...simplified];
    if (arenaBoundary.length > 0) {
        const first = arenaBoundary[0];
        const last = arenaBoundary[arenaBoundary.length - 1];
        const dist = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2);
        if (dist > 5) {
            arenaBoundary.push({ x: first.x, y: first.y });
        }
    }
    
    drawingPoints = [];
    document.getElementById('drawingPath').style.display = 'none';
    updateBoundaryDisplay();
}

function updateDrawingPath() {
    const path = document.getElementById('drawingPath');
    if (drawingPoints.length < 2) {
        path.setAttribute('d', '');
        return;
    }
    
    let pathData = `M ${drawingPoints[0].x} ${drawingPoints[0].y}`;
    for (let i = 1; i < drawingPoints.length; i++) {
        pathData += ` L ${drawingPoints[i].x} ${drawingPoints[i].y}`;
    }
    path.setAttribute('d', pathData);
}

function finishDrawingBoundary() {
    if (!arenaBoundary || arenaBoundary.length < 3) {
        if (drawingPoints.length > 0) {
            // Try to finalize current drawing
            handleDrawingEnd({});
            if (!arenaBoundary || arenaBoundary.length < 3) {
                alert('Please complete your drawing by releasing the mouse button.');
                return;
            }
        } else {
            alert('Please draw a boundary first by clicking and dragging on the map.');
            return;
        }
    }
    
    isDrawingBoundary = false;
    isDragging = false;
    drawingPoints = [];
    
    document.getElementById('gruulMap').classList.remove('drawing-mode');
    document.getElementById('startDrawingBtn').style.display = 'inline-block';
    document.getElementById('finishDrawingBtn').style.display = 'none';
    document.getElementById('drawingInstructions').style.display = 'none';
    document.getElementById('drawingPath').style.display = 'none';
    
    const svg = document.getElementById('gruulMap');
    svg.removeEventListener('mousedown', handleDrawingStart);
    svg.removeEventListener('mousemove', handleDrawingMove);
    svg.removeEventListener('mouseup', handleDrawingEnd);
    svg.removeEventListener('mouseleave', handleDrawingEnd);
    
    // Save to localStorage
    localStorage.setItem('gruulArenaBoundary', JSON.stringify(arenaBoundary));
    
    regeneratePositions();
}

function clearBoundary() {
    if (confirm('Clear the arena boundary? Positions will return to default layout.')) {
        arenaBoundary = null;
        isDrawingBoundary = false;
        isDragging = false;
        drawingPoints = [];
        
        document.getElementById('gruulMap').classList.remove('drawing-mode');
        document.getElementById('startDrawingBtn').style.display = 'inline-block';
        document.getElementById('finishDrawingBtn').style.display = 'none';
        document.getElementById('clearBoundaryBtn').style.display = 'none';
        document.getElementById('drawingInstructions').style.display = 'none';
        document.getElementById('drawingPath').style.display = 'none';
        
        const svg = document.getElementById('gruulMap');
        svg.removeEventListener('mousedown', handleDrawingStart);
        svg.removeEventListener('mousemove', handleDrawingMove);
        svg.removeEventListener('mouseup', handleDrawingEnd);
        svg.removeEventListener('mouseleave', handleDrawingEnd);
        
        localStorage.removeItem('gruulArenaBoundary');
        updateBoundaryDisplay();
        regeneratePositions();
    }
}

function updateBoundaryDisplay() {
    const polygon = document.getElementById('arenaPolygon');
    
    if (!arenaBoundary || arenaBoundary.length < 3) {
        polygon.setAttribute('points', '');
        polygon.style.display = 'none';
        return;
    }
    
    // Create points string for polygon
    const pointsStr = arenaBoundary.map(p => `${p.x},${p.y}`).join(' ');
    polygon.setAttribute('points', pointsStr);
    
    // Hide the boundary completely - it's only used for position calculation
    polygon.style.display = 'none';
}

// Render the map with positions
function renderMap() {
    const markersGroup = document.getElementById('positionMarkers');
    markersGroup.innerHTML = '';
    
    const showRoleColors = document.getElementById('showRoleColors').checked;
    
    // Update boundary display
    updateBoundaryDisplay();
    
    // Draw grid lines
    const gridGroup = document.getElementById('gridLines');
    gridGroup.innerHTML = '';
    
    // Draw concentric circles for reference
    const hasMapUnderlay = document.getElementById('mapUnderlay').complete && 
                           document.getElementById('mapUnderlay').naturalWidth > 0 &&
                           document.getElementById('showMapUnderlay').checked;
    const gridOpacity = hasMapUnderlay ? '0.25' : '0.1';
    
    // Draw grid lines only if no custom boundary (or if user wants them)
    if (!arenaBoundary || arenaBoundary.length < 3) {
        const innerRadius = Math.min(12, maxArenaRadius * 0.27);
        const middleRadius = Math.min(30, maxArenaRadius * 0.67);
        const outerRadius = Math.min(45, maxArenaRadius * 0.95);
        
        [innerRadius, middleRadius, outerRadius].forEach(yards => {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', MAP_CENTER);
            circle.setAttribute('cy', MAP_CENTER);
            circle.setAttribute('r', yards * YARDS_TO_PIXELS);
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', `rgba(255, 255, 255, ${gridOpacity})`);
            circle.setAttribute('stroke-width', '1');
            circle.setAttribute('stroke-dasharray', '5,5');
            gridGroup.appendChild(circle);
        });
    }
    
    // Draw positions
    positions.forEach(pos => {
        const raider = raiders.find(r => r.id === pos.assignedRaider);
        
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.classList.add('position-marker');
        group.dataset.positionId = pos.id;
        
        // Circle
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.classList.add('position-circle');
        circle.setAttribute('cx', pos.x);
        circle.setAttribute('cy', pos.y);
        circle.setAttribute('r', 15);
        
        if (raider) {
            if (showRoleColors) {
                circle.classList.add(raider.role);
            } else {
                circle.classList.add('assigned');
            }
        } else {
            circle.classList.add('empty');
        }
        
        // Position number (small)
        const numberText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        numberText.classList.add('position-number');
        numberText.setAttribute('x', pos.x);
        numberText.setAttribute('y', pos.y - 18);
        numberText.textContent = pos.id;
        
        // Raider name or position number
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.classList.add('position-text');
        text.setAttribute('x', pos.x);
        text.setAttribute('y', pos.y + 4);
        
        if (raider) {
            // Truncate long names
            const displayName = raider.name.length > 8 ? raider.name.substring(0, 7) + '...' : raider.name;
            text.textContent = displayName;
        } else {
            text.textContent = pos.id;
            text.style.opacity = '0.5';
        }
        
        group.appendChild(circle);
        group.appendChild(numberText);
        group.appendChild(text);
        
        // Click to unassign
        if (raider) {
            group.style.cursor = 'pointer';
            group.addEventListener('click', () => {
                if (confirm(`Unassign ${raider.name} from position ${pos.id}?`)) {
                    raider.position = null;
                    pos.assignedRaider = null;
                    renderRaiderList();
                    renderMap();
                }
            });
        }
        
        markersGroup.appendChild(group);
    });
}

// Render the raider list
function renderRaiderList() {
    const container = document.getElementById('raiderListContainer');
    container.innerHTML = '';
    
    const filteredRaiders = currentFilter === 'all' 
        ? raiders 
        : raiders.filter(r => r.role === currentFilter);
    
    if (filteredRaiders.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #718096; padding: 20px;">No raiders</p>';
        return;
    }
    
    filteredRaiders.forEach(raider => {
        const item = document.createElement('div');
        item.classList.add('raider-item', raider.role);
        
        const info = document.createElement('div');
        info.classList.add('raider-info');
        
        const name = document.createElement('div');
        name.classList.add('raider-name');
        name.textContent = raider.name;
        
        const role = document.createElement('div');
        role.classList.add('raider-role');
        role.textContent = raider.role;
        
        info.appendChild(name);
        info.appendChild(role);
        
        if (raider.position) {
            const posText = document.createElement('div');
            posText.classList.add('raider-position');
            posText.textContent = `Position ${raider.position}`;
            info.appendChild(posText);
        }
        
        const actions = document.createElement('div');
        actions.classList.add('raider-actions');
        
        const removeBtn = document.createElement('button');
        removeBtn.classList.add('btn', 'btn-danger');
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => removeRaider(raider.id));
        
        actions.appendChild(removeBtn);
        
        item.appendChild(info);
        item.appendChild(actions);
        container.appendChild(item);
    });
}

// Remove a raider
function removeRaider(id) {
    const raider = raiders.find(r => r.id === id);
    if (!raider) return;
    
    if (confirm(`Remove ${raider.name}?`)) {
        // Clear position assignment
        if (raider.position) {
            const pos = positions.find(p => p.id === raider.position);
            if (pos) pos.assignedRaider = null;
        }
        
        // Remove raider
        raiders = raiders.filter(r => r.id !== id);
        
        renderRaiderList();
        renderMap();
        updateRaiderCount();
    }
}

// Update raider count
function updateRaiderCount() {
    document.getElementById('raiderCount').textContent = raiders.length;
}

// Regenerate positions when arena size changes
function regeneratePositions() {
    // Store current assignments
    const assignments = {};
    positions.forEach(pos => {
        if (pos.assignedRaider) {
            assignments[pos.id] = pos.assignedRaider;
        }
    });
    
    // Regenerate positions
    generatePositions();
    
    // Restore assignments where possible
    positions.forEach(pos => {
        if (assignments[pos.id]) {
            pos.assignedRaider = assignments[pos.id];
        }
    });
    
    renderMap();
    renderRaiderList();
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);
