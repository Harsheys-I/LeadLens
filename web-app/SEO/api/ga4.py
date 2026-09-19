from http.server import BaseHTTPRequestHandler
import json
import os
import sys

DIRECTORY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if DIRECTORY not in sys.path:
    sys.path.insert(0, DIRECTORY)

try:
    from ga4_connector import fetch_ga4_metrics
except ImportError:
    fetch_ga4_metrics = None

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
        
        cached_file = os.path.join(DIRECTORY, 'ga4_live_data.json')
        
        if os.path.exists(cached_file):
            with open(cached_file, 'r', encoding='utf-8') as f:
                self.wfile.write(f.read().encode('utf-8'))
        elif fetch_ga4_metrics and os.path.exists(os.path.join(DIRECTORY, 'service_account.json')):
            try:
                live_data = fetch_ga4_metrics('534850003', days=30)
                self.wfile.write(json.dumps(live_data, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
        else:
            self.wfile.write(json.dumps({'error': 'GA4 data not available'}).encode('utf-8'))

    def do_POST(self):
        self.do_GET()
