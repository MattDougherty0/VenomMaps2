const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
const DIRECTORY = '/Users/mattdougherty/Desktop/Old Projects/VenomMaps2/web';

const server = http.createServer((req, res) => {
    let filePath = path.join(DIRECTORY, req.url === '/' ? 'index.html' : req.url);
    
    // Security check
    if (!filePath.startsWith(DIRECTORY)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    
    const extname = path.extname(filePath);
    let contentType = 'text/html';
    
    switch(extname) {
        case '.js':
            contentType = 'text/javascript';
            break;
        case '.css':
            contentType = 'text/css';
            break;
        case '.json':
            contentType = 'application/json';
            break;
        case '.png':
            contentType = 'image/png';
            break;
        case '.jpg':
            contentType = 'image/jpg';
            break;
        case '.geojson':
            contentType = 'application/json';
            break;
    }
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            res.writeHead(200, { 
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*'
            });
            res.end(content);
        }
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running at http://127.0.0.1:${PORT}/`);
    console.log(`Serving directory: ${DIRECTORY}`);
});

server.on('error', (err) => {
    console.error('Server error:', err);
});
