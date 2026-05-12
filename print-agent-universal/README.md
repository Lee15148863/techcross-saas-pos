# Tech Cross Print Agent (Windows)

Auto-detect thermal printer on LAN, silent printing via ESC/POS.

## Quick Install

1. Make sure **Node.js** is installed (https://nodejs.org/)
2. Double-click **`install.bat`**
3. Done — Print Agent runs on `http://localhost:9100` and auto-starts on boot

## Files

| File | Purpose |
|------|---------|
| `install.bat` | One-click install: npm install + auto-start setup + launch |
| `start.bat` | Manually start Print Agent |
| `stop.bat` | Stop Print Agent |
| `uninstall.bat` | Remove auto-start and stop service |
| `config.json` | Printer settings (IP, port, scan range) |

## Config

Edit `config.json` to change settings:

```json
{
  "port": 9100,
  "printer": {
    "ip": "AUTO",          // "AUTO" = scan LAN, or set fixed IP like "192.168.1.50"
    "port": 9100,
    "scanRanges": ["192.168.1", "192.168.0"],  // Networks to scan
    "scanTimeout": 300,    // ms per IP
    "rescanInterval": 60000  // rescan every 60s if printer lost
  },
  "paperWidth": 48         // characters per line (48 for 80mm, 32 for 58mm)
}
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/print` | POST | Send receipt data to print |
| `/status` | GET | Printer connection status |
| `/rescan` | GET | Force rescan for printer |

### POST /print

Accepts two formats:

**Structured receipt (from POS checkout):**
```json
{
  "receiptNumber": "20260502125513",
  "items": [...],
  "totalAmount": 29.99,
  "paymentMethod": "cash",
  ...
}
```

**Plain text:**
```json
{
  "content": "Hello World\nLine 2"
}
```

**Transaction reprint:**
```json
{
  "transaction": { ... }
}
```

## Troubleshooting

- **No printer found**: Check printer is powered on and connected to same network
- **Wrong network**: Edit `scanRanges` in config.json to match your network (e.g. `192.168.0`)
- **Fixed IP**: Set `"ip": "192.168.1.50"` instead of `"AUTO"` if you know the printer IP
- **Port conflict**: Change `"port"` in config.json if 9100 is taken
