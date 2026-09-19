from http.server import BaseHTTPRequestHandler
import json
import os
import sys

DIRECTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if DIRECTORY not in sys.path:
    sys.path.insert(0, DIRECTORY)

try:
    from gsc_connector import fetch_gsc_performance
except ImportError:
    fetch_gsc_performance = None

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        cached_file = os.path.join(DIRECTORY, 'gsc_live_data.json')
        
        # Try live fetch if requested or fallback to cache
        if fetch_gsc_performance and os.path.exists(os.path.join(DIRECTORY, 'service_account.json')):
            try:
                live_data = fetch_gsc_performance('https://gurupunvaanii.com/', days=30)
                self.wfile.write(json.dumps(live_data, ensure_ascii=False).encode('utf-8'))
                return
            except Exception as e:
                pass
                
        if os.path.exists(cached_file):
            with open(cached_file, 'r', encoding='utf-8') as f:
                self.wfile.write(f.read().encode('utf-8'))
        else:
            self.wfile.write(json.dumps({'error': 'GSC data not available'}).encode('utf-8'))

    def do_POST(self):
        self.do_GET()
