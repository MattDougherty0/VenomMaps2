#!/usr/bin/env python3
import http.server
import socketserver
import os

PORT = 8000
DIRECTORY = "/Users/mattdougherty/Desktop/Old Projects/VenomMaps2/web"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Server running at http://localhost:{PORT}")
    print(f"Serving directory: {DIRECTORY}")
    httpd.serve_forever()
