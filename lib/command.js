const dgram = require('dgram')
const events = require('events')
const crypto = require('crypto')

const MULTICAST_ADDRESS = '224.0.0.50'
const SERVER_PORT = 9898
const DISCOVERY_PORT = 4321
const AQARA_IV = Buffer.from([0x17, 0x99, 0x6d, 0x09, 0x3d, 0x28, 0xdd, 0xb3, 0xba, 0x69, 0x5a, 0x2e, 0x6f, 0x58, 0x56, 0x2e])

module.exports = function command(action, params) {
    return new Promise(function (resolve, reject) {
        var timers = setTimeout(() => {
            _failure("Timeout");
        }, 1000);
        var nbAnswers = 0
        serverSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        serverSocket.on('listening', () => {
            serverSocket.addMembership(MULTICAST_ADDRESS, '127.0.0.1');
            switch (action) {
                case 'discover':
                    _sendMessage('{"cmd": "whois"}', DISCOVERY_PORT);
                    break;
                case 'setColor':
                    _sendMessage('{"cmd": "get_id_list"}');
                    break;
                case 'getState':
                    sid = params[0];
                    _sendMessage(JSON.stringify({ cmd: "read", sid: sid }));
                    break;
                default:
                    _failure("action " + action + " non supportée...");
            }
        });

        serverSocket.on('message', (msg) => handleMessage(msg));

        function handleMessage(msg) {
            const parsed = JSON.parse(msg.toString());
            switch (action + "|" + parsed.cmd) {
                case 'discover|iam':
                    _success(parsed.sid);
                    break;

                case 'setColor|get_id_list_ack':
                    token = parsed.token;
                    sid = params[0];
                    password = params[1];
                    color = params[2];
                    const value = color.intensity * Math.pow(2, 24) + color.r * Math.pow(2, 16) + color.g * Math.pow(2, 8) + color.b;
                    const cipher = crypto.createCipheriv('aes-128-cbc', password, AQARA_IV);
                    key = cipher.update(token, 'ascii', 'hex');

                    _sendMessage(JSON.stringify({ cmd: "write", model: "gateway", sid: sid, short_id: 0, data: { rgb: value, key: key } }));
                    break;

                case 'setColor|write_ack':
                    _success('success');
                    break;

                case 'getState|read_ack':
                    data = JSON.parse(parsed.data);
                    illumination = data.illumination;
                    rgb = data.rgb;
                    intensity = Math.trunc(rgb / Math.pow(2, 24));
                    r = Math.trunc((rgb % Math.pow(2, 24)) / Math.pow(2, 16));
                    g = Math.trunc((rgb % Math.pow(2, 16)) / Math.pow(2, 8));
                    b = rgb % Math.pow(2, 8);
                    _success({ illumination: illumination, intensity: intensity, r: r, g: g, b: b });
                    break;

                default:
                    nbAnswers++;
                    if (nbAnswers > 3) {
                        _failure("Pas de réponse du gateway");
                    }
            }
        };

        function _sendMessage(payload, port) {
            if (!port) {
                port = SERVER_PORT;
            }
            serverSocket.send(payload, 0, payload.length, port, MULTICAST_ADDRESS);
        };

        function _success(result) {
            if (timers) clearTimeout(timers);
            serverSocket.close();
            return resolve(result);
        };

        function _failure(msg) {
            if (timers) clearTimeout(timers);
            serverSocket.close();
            return reject(new Error(msg))
        };

        serverSocket.bind(SERVER_PORT);
    })
}