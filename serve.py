#!/usr/bin/env python3
"""
serve.py - HTTPS & HTTP server accessible to all devices on the network.
Binds to 0.0.0.0 (all network interfaces).
Supports SSL/TLS for mobile Geolocation API access.
"""

import http.server
import socket
import ssl
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
CERT_FILE = os.path.join(DIRECTORY, 'cert', 'cert.pem')
KEY_FILE = os.path.join(DIRECTORY, 'cert', 'key.pem')

def get_network_ips():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.1)
        s.connect(('8.8.8.8', 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass

    for candidate in ['10.11.2.13', '192.168.5.15']:
        if candidate not in ips:
            ips.append(candidate)

    return ips

class CustomHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        if hasattr(self, 'path') and ('sw.js' in self.path):
            self.send_header('Service-Worker-Allowed', '/')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.js') or path.endswith('.mjs'):
            return 'application/javascript'
        if path.endswith('.css'):
            return 'text/css'
        if path.endswith('.html'):
            return 'text/html'
        if path.endswith('manifest.json') or path.endswith('.webmanifest'):
            return 'application/manifest+json'
        if path.endswith('.svg'):
            return 'image/svg+xml'
        return super().guess_type(path)

class ReusableHTTPServer(http.server.HTTPServer):
    allow_reuse_address = True

if __name__ == '__main__':
    use_ssl = os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE)
    scheme = 'https' if use_ssl else 'http'

    httpd = ReusableHTTPServer(('0.0.0.0', PORT), CustomHTTPHandler)

    if use_ssl:
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ssl_context.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
        httpd.socket = ssl_context.wrap_socket(httpd.socket, server_side=True)

    net_ips = get_network_ips()
    print('=' * 65)
    print(f'🔒 Take Me Home {scheme.upper()} Server is running across the network!')
    print(f'   Local URL:    {scheme}://localhost:{PORT}')
    for ip in net_ips:
        print(f'   Network URL:  {scheme}://{ip}:{PORT}')
    print('=' * 65)
    print('Press Ctrl+C to stop.')
    sys.stdout.flush()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
