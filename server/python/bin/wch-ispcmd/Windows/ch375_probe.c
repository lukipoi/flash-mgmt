/*
 * ch375_probe.c — CH375 传输层探针（只读）
 * 打开设备，dump 设备描述符 + 配置描述符（含端点地址），并尝试数据块上传管道读。
 */
#include <windows.h>
#include <stdio.h>

typedef ULONG  (WINAPI *fn_Open)(ULONG iIndex);
typedef VOID   (WINAPI *fn_Close)(ULONG iIndex);
typedef BOOL   (WINAPI *fn_GetDevDescr)(ULONG iIndex, PVOID oBuffer, PULONG ioLength);
typedef BOOL   (WINAPI *fn_GetCfgDescr)(ULONG iIndex, PVOID oBuffer, PULONG ioLength);
typedef BOOL   (WINAPI *fn_ReadData)(ULONG iIndex, PVOID oBuffer, PULONG ioLength);

static void dump(const unsigned char *p, ULONG n) {
    for (ULONG i = 0; i < n; i++) printf("%02X ", p[i]);
    printf("\n");
}

int main(void) {
    HMODULE d = LoadLibraryExA("C:\\WCH.CN\\App\\WCHISPTool\\CH375DLL.dll", NULL, LOAD_WITH_ALTERED_SEARCH_PATH);
    if (!d) { printf("[ERR] load failed %lu\n", GetLastError()); return 1; }
    fn_Open       pOpen  = (fn_Open)GetProcAddress(d, "CH375OpenDevice");
    fn_Close      pClose = (fn_Close)GetProcAddress(d, "CH375CloseDevice");
    fn_GetDevDescr pDev  = (fn_GetDevDescr)GetProcAddress(d, "CH375GetDeviceDescr");
    fn_GetCfgDescr pCfg  = (fn_GetCfgDescr)GetProcAddress(d, "CH375GetConfigDescr");
    fn_ReadData   pReadD = (fn_ReadData)GetProcAddress(d, "CH375ReadData");

    for (ULONG i = 0; i < 4; i++) {
        ULONG h = pOpen(i);
        if (h == 0xFFFFFFFFUL) { printf("index %lu: closed\n", i); continue; }
        printf("index %lu: opened\n", i);

        unsigned char dd[64] = {0};
        ULONG len = sizeof(dd);
        if (pDev && pDev(i, dd, &len)) {
            printf("  devDescr(%lu): ", len); dump(dd, len > 18 ? 18 : len);
        } else printf("  devDescr failed %lu\n", GetLastError());

        unsigned char cd[128] = {0};
        len = sizeof(cd);
        if (pCfg && pCfg(i, cd, &len)) {
            printf("  cfgDescr(%lu): ", len); dump(cd, len > 64 ? 64 : len);
            for (ULONG k = 0; k + 7 <= len; k++) {
                if (cd[k] == 7 && cd[k+1] == 5) {
                    printf("    EP 0x%02X attr=0x%02X maxpkt=%d\n",
                           cd[k+2], cd[k+3], cd[k+4] | (cd[k+5] << 8));
                }
            }
        } else printf("  cfgDescr failed %lu\n", GetLastError());

        unsigned char rb[64] = {0};
        len = sizeof(rb);
        if (pReadD && pReadD(i, rb, &len)) printf("  ReadData ok len=%lu\n", len);
        else printf("  ReadData failed %lu\n", GetLastError());

        pClose(i);
    }
    return 0;
}
