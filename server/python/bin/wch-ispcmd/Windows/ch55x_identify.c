/*
 * ch55x_identify.exe — CH55x USB ISP 芯片信息读取（只读 identify）
 *
 * 架构（2026-10-31 爆改版）：
 *   传输层：WCH 官方 CH375DLL.dll（设备已绑 CH375_A64 驱动，免 Zadig），
 *           CH375OpenDevice / CH375WriteData(EP2 OUT) / CH375ReadData(EP2 IN)
 *   协议层：ch55xtool (MarsTechHAN/ch552tool, GPL-3.0) 的开源 CH55x ISP 协议：
 *           包格式 = 命令码(1) + 载荷长度 u16LE + 载荷
 *           应答   = 命令回显(1) + 状态(1) + 长度 u16LE + 载荷
 *           Detect(0xA1):  载荷 b'\x42\x10' + b'MCU ISP & WCH.CN'
 *                          → 载荷 2 字节 = chip_id, chip_subid
 *           ReadConfig(0xA7): 载荷 = 请求字段 u16LE (FLAG_BOOTVER=0x08|FLAG_UID=0x10)
 *                          → 载荷 = 回显字段 u16LE + BOOT 版本 4 字节 + UID 8 字节
 *           EP: OUT 0x02 / IN 0x82（CH375DLL 的数据块下传/上传管道）
 *   VID/PID = 0x4348/0x55E0（CH55x 出厂 BOOT，datasheet/官方 PDF 实锤）
 *
 * 用法：ch55x_identify.exe [--usb]（现有实现只有 USB 一条路，多余参数忽略）
 * 输出约定（与 stc_read.py 同款）：stdout 只输出最终 JSON；过程日志全走 stderr（纯 ASCII）。
 * 本工具只读：仅 Detect + ReadConfig，无任何擦/写命令。
 */

#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef unsigned char UCHAR, *PUCHAR;
typedef unsigned long ULONG, *PULONG;
typedef int BOOL, *PBOOL;
typedef unsigned int UINT, *PUINT;

/* ---- CH375DLL API（官方 CH375DLL.H，SOURCE37.ZIP） ---- */
typedef HANDLE (WINAPI *fn_Open)(ULONG iIndex);
typedef VOID   (WINAPI *fn_Close)(ULONG iIndex);
typedef BOOL   (WINAPI *fn_GetDescr)(ULONG iIndex, PVOID oBuffer, PULONG ioLength);
typedef BOOL   (WINAPI *fn_ReadData)(ULONG iIndex, PVOID oBuffer, PULONG ioLength);
typedef BOOL   (WINAPI *fn_WriteData)(ULONG iIndex, PVOID iBuffer, PULONG ioLength);
typedef BOOL   (WINAPI *fn_SetTimeout)(ULONG iIndex, ULONG iReadMs, ULONG iWriteMs);

/* ---- ch55xtool 协议常量 ---- */
#define EP_PKT_MAX      64
#define CMD_DETECT      0xA1
#define CMD_READCFG     0xA7
#define FLAG_BOOTVER    0x08
#define FLAG_UID        0x10
#define USB_TIMEOUT_MS  5000

static void logf_(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    vfprintf(stderr, fmt, ap);
    va_end(ap);
    fputc('\n', stderr);
    fflush(stderr);
}

/* stdout 只输出最终 JSON（防日志污染） */
static void print_json(const char *ok, const char *payload) {
    printf("{\"ok\":%s%s%s}\n", ok,
           (payload && payload[0]) ? "," : "",
           (payload && payload[0]) ? payload : "");
    fflush(stdout);
}

static void hex_upper(const unsigned char *p, int n, char *out) {
    static const char *h = "0123456789ABCDEF";
    for (int i = 0; i < n; i++) {
        out[i * 2]     = h[p[i] >> 4];
        out[i * 2 + 1] = h[p[i] & 0x0F];
    }
    out[n * 2] = 0;
}

/* chip_id → 型号（ch55xtool typeall.wcfg 官方映射） */
static const char *chip_id_to_model(unsigned int id) {
    switch (id) {
        case 81:  return "CH551";
        case 82:  return "CH552";
        case 84:  return "CH554";
        case 85:  return "CH555";
        case 86:  return "CH556";
        case 87:  return "CH557";
        case 88:  return "CH558";
        case 89:  return "CH559";
        case 68:  return "CH544";
        case 69:  return "CH545";
        case 70:  return "CH546";
        case 71:  return "CH547";
        case 72:  return "CH548";
        case 73:  return "CH549";
        default:  return NULL;   /* 未知型号：交由调用方按 id 显示 */
    }
}

/* 发送一帧 ISP 命令并收取应答。返回 0=成功；应答帧在 reply/replyLen */
static int isp_cmd(fn_WriteData pWrite, fn_ReadData pRead, ULONG idx,
                   unsigned char cmd, const unsigned char *payload, int payloadLen,
                   unsigned char *reply, int *replyLen) {
    unsigned char pkt[EP_PKT_MAX];
    ULONG wlen = 0;
    if (3 + payloadLen > (int)sizeof(pkt)) return -1;
    pkt[0] = cmd;
    pkt[1] = (unsigned char)(payloadLen & 0xFF);
    pkt[2] = (unsigned char)((payloadLen >> 8) & 0xFF);
    if (payloadLen > 0) memcpy(pkt + 3, payload, payloadLen);
    wlen = 3 + payloadLen;

    if (!pWrite(idx, pkt, &wlen)) {
        logf_("[ERR] CH375WriteData failed (cmd 0x%02X) GetLastError=%lu", cmd, GetLastError());
        return -1;
    }
    ULONG rlen = EP_PKT_MAX;
    if (!pRead(idx, reply, &rlen)) {
        logf_("[ERR] CH375ReadData failed / timeout (cmd 0x%02X) GetLastError=%lu", cmd, GetLastError());
        return -1;
    }
    if (rlen < 4 || reply[0] != cmd) {
        logf_("[WARN] bad reply frame (cmd 0x%02X): first bytes %02X %02X %02X %02X",
              cmd, reply[0], rlen > 1 ? reply[1] : 0, rlen > 2 ? reply[2] : 0, rlen > 3 ? reply[3] : 0);
        return -1;
    }
    int plen = reply[2] | (reply[3] << 8);
    if (plen > (int)rlen - 4) plen = (int)rlen - 4;
    *replyLen = plen;
    return reply[1];   /* 状态字节 */
}

int main(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        /* 兼容旧参数：现在的实现只有 USB 一条路，多余参数直接忽略 */
    }

    char dllPath[MAX_PATH];
    HMODULE dll = NULL;
    {
        char exeDir[MAX_PATH];
        GetModuleFileNameA(NULL, exeDir, MAX_PATH);
        char *slash = strrchr(exeDir, '\\');
        if (slash) *slash = 0;
        snprintf(dllPath, sizeof(dllPath), "%s\\CH375DLL.dll", exeDir);
        dll = LoadLibraryExA(dllPath, NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
        if (!dll) {
            strcpy(dllPath, "C:\\WCH.CN\\App\\WCHISPTool\\CH375DLL.dll");
            dll = LoadLibraryExA(dllPath, NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
        }
    }
    if (!dll) {
        logf_("[ERR] CH375DLL.dll not found (install official WCHISPTool or put DLL beside this exe)");
        print_json("false", "\"error\":\"dll_not_found\"");
        return 2;
    }
    logf_("[INFO] CH375DLL.dll loaded");

    fn_Open       pOpen  = (fn_Open)GetProcAddress(dll, "CH375OpenDevice");
    fn_Close      pClose = (fn_Close)GetProcAddress(dll, "CH375CloseDevice");
    fn_GetDescr   pDescr = (fn_GetDescr)GetProcAddress(dll, "CH375GetDeviceDescr");
    fn_ReadData   pRead  = (fn_ReadData)GetProcAddress(dll, "CH375ReadData");
    fn_WriteData  pWrite = (fn_WriteData)GetProcAddress(dll, "CH375WriteData");
    fn_SetTimeout pTimeo = (fn_SetTimeout)GetProcAddress(dll, "CH375SetTimeout");
    if (!pOpen || !pClose || !pRead || !pWrite) {
        logf_("[ERR] CH375DLL exports missing (OpenDevice/ReadData/WriteData)");
        print_json("false", "\"error\":\"dll_export_missing\"");
        return 2;
    }

    /* ---- 找 CH55x BOOT 设备：逐个打开 CH375 设备，用 Detect 应答做过滤器
     * （Detect 带 18 字节魔数，只有 CH55x BOOT 才会正确应答，比描述符过滤更可靠；
     *   部分 CH375 驱动版本 GetDeviceDescr 拿不到完整描述符，不依赖它） ---- */
    ULONG idx = 0xFFFFFFFFUL;
    int found = 0;
    unsigned char reply[EP_PKT_MAX];
    int replyLen = 0;
    unsigned int chipId = 0, chipSubId = 0;

    unsigned char detPl[18] = { 0x42, 0x10 };
    memcpy(detPl + 2, "MCU ISP & WCH.CN", 16);

    /* 两轮探测：设备空闲挂起（USB selective suspend / 楔死）时 WriteData/ReadData
     * 会报错 31，短暂等待后重开重试通常即可恢复；仍不行则由后端做 wlink 断电重启。 */
    for (int pass = 0; pass < 2 && !found; pass++) {
        if (pass > 0) {
            logf_("[INFO] retrying after short delay (pass %d)...", pass + 1);
            Sleep(700);
        }
        for (ULONG i = 0; i < 16 && !found; i++) {
            HANDLE h = pOpen(i);
            if (h == INVALID_HANDLE_VALUE || h == 0) continue;
            logf_("[INFO] CH375 index %lu opened, probing Detect...", i);
            /* CH375SetTimeout 签名未核实，先不调：参数错会踩坏 stdcall 栈 */
            int st = isp_cmd(pWrite, pRead, i, CMD_DETECT, detPl, sizeof(detPl), reply, &replyLen);
            logf_("[INFO] probe idx %lu: status=0x%02X replyLen=%d payload=%02X %02X %02X %02X", i, st, replyLen, reply[4], reply[5], reply[6], reply[7]);
            if (replyLen >= 2) {
                idx = i;
                found = 1;
                chipId    = reply[4];
                chipSubId = reply[5];
                logf_("[INFO] CH55x BOOT device found at index %lu (chip_id=0x%02X subid=0x%02X)",
                      i, chipId, chipSubId);
                continue;   /* 保持打开 */
            }
            pClose(i);
        }
    }
    if (!found) {
        logf_("[ERR] no CH55x BOOT device answered Detect on CH375 driver");
        print_json("true", "\"devices\":[]");
        return 0;
    }

    /* ---- ReadConfig (0xA7)：请求 BOOTVER + UID ---- */
    unsigned char cfgPl[2] = { FLAG_BOOTVER | FLAG_UID, 0x00 };
    int st = isp_cmd(pWrite, pRead, idx, CMD_READCFG, cfgPl, sizeof(cfgPl), reply, &replyLen);
    pClose(idx);
    if (replyLen < 2) {
        if (st != 0) logf_("[ERR] ReadConfig status=0x%02X replyLen=%d", st, replyLen);
        else         logf_("[ERR] ReadConfig reply too short");
        print_json("true", "\"devices\":[]");
        return 0;
    }
    int off = 4;
    unsigned int replyFields = reply[off] | (reply[off + 1] << 8);
    off += 2;
    unsigned char uid[8] = {0}, bootver[4] = {0};
    if ((replyFields & FLAG_BOOTVER) && off + 4 <= 4 + replyLen) {
        memcpy(bootver, reply + off, 4);
        off += 4;
    }
    if ((replyFields & FLAG_UID) && off + 8 <= 4 + replyLen) {
        memcpy(uid, reply + off, 8);
        off += 8;
    }

    char uidHex[17], verHex[9];
    hex_upper(uid, 8, uidHex);
    hex_upper(bootver, 4, verHex);
    const char *model = chip_id_to_model(chipId);
    char modelBuf[32];
    if (!model) {
        snprintf(modelBuf, sizeof(modelBuf), "CH55x(0x%02X)", chipId);
        model = modelBuf;
    }
    int uidValid = !(uid[0] == 0 && uid[1] == 0 && uid[2] == 0 && uid[3] == 0 &&
                     uid[4] == 0 && uid[5] == 0 && uid[6] == 0 && uid[7] == 0) &&
                   !(uid[0] == 0xFF && uid[1] == 0xFF && uid[2] == 0xFF && uid[3] == 0xFF &&
                     uid[4] == 0xFF && uid[5] == 0xFF && uid[6] == 0xFF && uid[7] == 0xFF);

    logf_("[INFO] found %s (chip_id=0x%02X subid=0x%02X) UID=%s BOOTVER=%s",
          model, chipId, chipSubId, uidHex, verHex);

    char payload[512];
    /* BOOT 版本字节 [0]=主版本高位 [1]=主版本低位 [2]=次版本 [3]=保留 → BTV 2.50 */
    snprintf(payload, sizeof(payload),
             "\"devices\":[{\"index\":0,\"port\":\"\",\"mcu_type\":%u,"
             "\"model\":\"%s\",\"uid\":\"%s\",\"uid_length\":8,"
             "\"isp_ver\":\"%u.%u%u\",\"support_uid\":true,\"uid_valid\":%s}]",
             chipId, model, uidHex,
             bootver[1], bootver[2], bootver[3],
             uidValid ? "true" : "false");
    print_json("true", payload);
    return 0;
}
