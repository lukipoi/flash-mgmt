' Chip Manager 端口检测脚本
' 功能：检测开发服务器是否已启动，已启动则弹窗显示端口信息
' 用法：双击运行即可，自动检测 http://localhost:3080

Dim Port, Url, Http, Ready
Port = 3080
Url = "http://localhost:" & Port
Ready = False

' ---- 检测端口是否就绪 ----
On Error Resume Next
Set Http = CreateObject("MSXML2.XMLHTTP")
Http.Open "GET", Url & "/api/stats", False
Http.SetTimeouts 2000, 2000, 2000, 2000
Http.Send
If Err.Number = 0 And Http.Status = 200 Then
    Ready = True
End If
Err.Clear
Set Http = Nothing
On Error GoTo 0

' ---- 弹窗显示结果 ----
If Ready Then
    MsgBox "Chip Manager 正在运行" & vbCrLf & vbCrLf & _
           "  端口: " & Port & vbCrLf & _
           "  地址: " & Url & vbCrLf & vbCrLf & _
           "服务正常运行中。", _
           vbInformation + vbOKOnly, "Chip Manager - 运行中"
Else
    MsgBox "Chip Manager 未启动" & vbCrLf & vbCrLf & _
           "  端口: " & Port & vbCrLf & _
           "  地址: " & Url & vbCrLf & vbCrLf & _
           "请先运行 start_dev.vbs 启动服务。", _
           vbExclamation + vbOKOnly, "Chip Manager - 未启动"
End If