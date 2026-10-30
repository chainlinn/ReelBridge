#!/usr/bin/env python3
"""One PoW verification attempt; no login, credentials, search or transfers.
Run in the same network namespace as PanSou for a meaningful comparison.
Reads GYING_URL and PROXY; reports only cookie names and fixed result categories.
"""
import http.cookiejar
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request


def probe():
    base = os.environ.get('GYING_URL', '').rstrip('/')
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ValueError('GYING_URL must be an HTTPS site origin')
    host = parsed.hostname.encode('idna').decode('ascii')
    base = 'https://' + host + (':' + str(parsed.port) if parsed.port else '')
    proxy = os.environ.get('PROXY', '')
    proxy_scheme = urllib.parse.urlsplit(proxy).scheme
    if proxy and proxy_scheme not in ('http', 'https'):
        raise ValueError('probe supports HTTP(S) proxy only; do not silently bypass SOCKS')
    jar = http.cookiejar.CookieJar()
    proxies = {'http': proxy, 'https': proxy} if proxy else {}
    op = urllib.request.build_opener(urllib.request.ProxyHandler(proxies), urllib.request.HTTPCookieProcessor(jar))
    op.addheaders = [('User-Agent', 'Mozilla/5.0')]

    def request(path, data=None):
        req = urllib.request.Request(base + path, data=data)
        if data is not None:
            req.add_header('Content-Type', 'application/x-www-form-urlencoded')
        try:
            res = op.open(req, timeout=30)
        except urllib.error.HTTPError as error:
            res = error
        with res:
            raw = res.read(65537)
            if len(raw) > 65536:
                raise ValueError('response too large')
            return res.status, raw

    def report(**values):
        print(json.dumps(values, ensure_ascii=False), flush=True)

    report(stage='network', proxy_enabled=bool(proxy))
    status, raw = request('/')
    report(stage='homepage', http=status, challenge=b'powSolve-' in raw, cookie_names=[c.name for c in jar])
    status, raw = request('/res/pow')
    data = json.loads(raw)
    modulus, value, steps = int(data['N'], 16), int(data['x'], 16), data['t']
    if not isinstance(steps, int) or not 0 < steps <= 2000000 or not 1 < modulus.bit_length() <= 8192 or value < 0:
        raise ValueError('invalid or excessive PoW challenge')
    report(stage='challenge', http=status, modulus_bits=modulus.bit_length(), steps=steps, cookie_names=[c.name for c in jar])
    start = time.monotonic()
    for _ in range(steps):
        value = value * value % modulus
        if time.monotonic() - start > 60:
            raise TimeoutError('PoW computation exceeded 60 seconds')
    duration = time.monotonic() - start
    time.sleep(max(0, 3 - duration))
    body = urllib.parse.urlencode({'y': format(value, 'x')}).encode()
    status, raw = request('/res/pow', body)
    result = json.loads(raw)
    success = result.get('success') is True
    # Never echo server text, challenge values, IDs or cookie values.
    report(stage='verification', http=status, success=success, compute_seconds=round(duration, 3),
           cookie_names=[c.name for c in jar], response_fields=sorted(k for k in result if k in ('success', 'msg', 'message', 'code', 'error', 'challenge_id')))
    return 0 if success else 1


if __name__ == '__main__':
    try:
        raise SystemExit(probe())
    except Exception as error:
        print(json.dumps({'stage': 'probe_error', 'error_type': type(error).__name__}), flush=True)
        raise SystemExit(1)
