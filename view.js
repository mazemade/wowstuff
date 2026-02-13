// Game constants (same as main app)
const YARDS_TO_PIXELS = 8;
const MAP_CENTER = 400;
const DEFAULT_MAP_UNDERLAY = 'GruulLairMap.png';

// State
let raiders = [];
let positions = [];
let arenaBoundary = null;

// Check if a point is inside a polygon using ray casting algorithm
function pointInPolygon(point, polygon) {
    if (!polygon || polygon.length < 3) return true;
    
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

// Create ellipse boundary (fallback)
function createEllipseBoundary(centerX, centerY, width, height) {
    const points = [];
    const numPoints = 40;
    
    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        const x = centerX + (width / 2) * Math.cos(angle);
        const y = centerY + (height / 2) * Math.sin(angle);
        points.push({ x, y });
    }
    
    return points;
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
                console.log('CORS issue with image, using ellipse fallback');
                resolve(createEllipseBoundary(400, 400, 320, 280));
                return;
            }
            
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Scale to our SVG coordinate system (800x800)
            const scaleX = 800 / canvas.width;
            const scaleY = 800 / canvas.height;
            
            // Find white border pixels
            const borderPoints = [];
            const step = 2;
            
            for (let y = 0; y < canvas.height; y += step) {
                for (let x = 0; x < canvas.width; x += step) {
                    const idx = (y * canvas.width + x) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];
                    const a = data[idx + 3];
                    
                    // Detect white border: very high RGB values
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
                resolve(createEllipseBoundary(400, 400, 320, 280));
            }
        } catch (error) {
            console.error('Error detecting white border:', error);
            resolve(createEllipseBoundary(400, 400, 320, 280));
        }
    });
}

// Create boundary polygon from border points
function createBoundaryFromBorderPoints(borderPoints) {
    if (borderPoints.length < 3) {
        return createEllipseBoundary(400, 400, 320, 280);
    }
    
    // Find the center
    let sumX = 0, sumY = 0;
    borderPoints.forEach(p => {
        sumX += p.x;
        sumY += p.y;
    });
    const centerX = sumX / borderPoints.length;
    const centerY = sumY / borderPoints.length;
    
    // Sort points by angle from center
    const sortedPoints = borderPoints
        .map(p => ({
            x: p.x,
            y: p.y,
            angle: Math.atan2(p.y - centerY, p.x - centerX),
            dist: Math.sqrt((p.x - centerX) ** 2 + (p.y - centerY) ** 2)
        }))
        .sort((a, b) => a.angle - b.angle);
    
    // Group by angle and take closest point to center
    const angleGroups = {};
    sortedPoints.forEach(p => {
        const angleKey = Math.round(p.angle * 100) / 100;
        if (!angleGroups[angleKey] || p.dist < angleGroups[angleKey].dist) {
            angleGroups[angleKey] = p;
        }
    });
    
    // Convert back to array
    const boundaryPoints = Object.values(angleGroups)
        .sort((a, b) => a.angle - b.angle)
        .map(p => ({ x: p.x, y: p.y }));
    
    // Simplify
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

function updateBoundaryDisplay() {
    const polygon = document.getElementById('arenaPolygon');
    
    if (!arenaBoundary || arenaBoundary.length < 3) {
        polygon.setAttribute('points', '');
        polygon.style.display = 'none';
        return;
    }
    
    const pointsStr = arenaBoundary.map(p => `${p.x},${p.y}`).join(' ');
    polygon.setAttribute('points', pointsStr);
    polygon.style.display = 'none';
}

function setMapUnderlay(src) {
    const underlay = document.getElementById('mapUnderlay');
    const dimmer = document.getElementById('mapUnderlayDimmer');

    underlay.onload = async () => {
        // Auto-detect white border from map image
        if (underlay.complete && underlay.naturalWidth > 0) {
            try {
                const detectedBoundary = await detectWhiteBorderFromMap(underlay);
                arenaBoundary = detectedBoundary;
                updateBoundaryDisplay();
                renderMap();
            } catch (e) {
                console.error('Error detecting white border:', e);
                arenaBoundary = createEllipseBoundary(400, 400, 320, 280);
                updateBoundaryDisplay();
                renderMap();
            }
        }
        
        toggleMapUnderlayVisibility();
    };

    underlay.onerror = () => {
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

// Render the map with positions (read-only)
function renderMap() {
    const markersGroup = document.getElementById('positionMarkers');
    markersGroup.innerHTML = '';
    
    const showRoleColors = document.getElementById('showRoleColors').checked;
    
    // Update boundary display
    updateBoundaryDisplay();
    
    // Draw grid lines
    const gridGroup = document.getElementById('gridLines');
    gridGroup.innerHTML = '';
    
    const hasMapUnderlay = document.getElementById('mapUnderlay').complete && 
                           document.getElementById('mapUnderlay').naturalWidth > 0 &&
                           document.getElementById('showMapUnderlay').checked;
    const gridOpacity = hasMapUnderlay ? '0.25' : '0.1';
    
    // Draw grid lines only if no custom boundary
    if (!arenaBoundary || arenaBoundary.length < 3) {
        const innerRadius = 12;
        const middleRadius = 30;
        const outerRadius = 45;
        
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
        
        // Position number
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
            const displayName = raider.name.length > 8 ? raider.name.substring(0, 7) + '...' : raider.name;
            text.textContent = displayName;
        } else {
            text.textContent = pos.id;
            text.style.opacity = '0.5';
        }
        
        group.appendChild(circle);
        group.appendChild(numberText);
        group.appendChild(text);
        
        // No click handlers - read-only mode
        markersGroup.appendChild(group);
    });
}

// Initialize view-only mode
function init() {
    // Get data from URL
    const urlParams = new URLSearchParams(window.location.search);
    const encodedData = urlParams.get('data');
    
    if (!encodedData) {
        document.body.innerHTML = '<div style="text-align: center; padding: 50px; color: #e0e0e0;"><h1>Invalid Link</h1><p>No data found in the share link. Please request a new link from your raid leader.</p></div>';
        return;
    }
    
    try {
        // Decode base64
        const decoded = decodeURIComponent(escape(atob(encodedData)));
        const setup = JSON.parse(decoded);
        
        // Load data
        raiders = setup.raiders || [];
        positions = setup.positions || [];
        
        if (raiders.length === 0 || positions.length === 0) {
            document.body.innerHTML = '<div style="text-align: center; padding: 50px; color: #e0e0e0;"><h1>No Data</h1><p>No raid positions found in this link.</p></div>';
            return;
        }
        
        // Setup event listeners for map controls
        document.getElementById('showGridLines').addEventListener('change', (e) => {
            document.getElementById('gridLines').style.display = e.target.checked ? 'block' : 'none';
        });
        
        document.getElementById('showRoleColors').addEventListener('change', () => {
            renderMap();
        });
        
        document.getElementById('showMapUnderlay').addEventListener('change', toggleMapUnderlayVisibility);
        
        // Initialize map underlay
        setMapUnderlay(DEFAULT_MAP_UNDERLAY);
        
        // Render map
        renderMap();
        
    } catch (error) {
        console.error('Error loading share data:', error);
        document.body.innerHTML = '<div style="text-align: center; padding: 50px; color: #e0e0e0;"><h1>Error Loading Data</h1><p>The share link appears to be invalid or corrupted. Please request a new link from your raid leader.</p></div>';
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);
