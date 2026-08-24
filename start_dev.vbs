' Chip Manager 启动脚本
' 功能：静默启动 Nuxt 开发服务器，启动前提示端口，就绪后弹窗通知

Dim WshShell, Port, Url
Port = 3080
Url = "http://localhost:" & Port

' ---- 1. 启动前提示 ----
MsgBox "即将启动 Chip Manager 开发服务器" & vbCrLf & vbCrLf & _
       "  端口: " & Port & vbCrLf & _
       "  地址: " & Url & vbCrLf & vbCrLf & _
       "点击"确定"开始启动（后台静默运行）", _
       vbInformation + vbOKOnly, "Chip Manager - 启动中"

' ---- 2. 静默启动 Nuxt 开发服务器 ----
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c ""d:\CH341-SPI\flash-mgmt\start_dev.bat""", 0, False

' ---- 3. 等待端口就绪（最多约 90 秒）----
Dim i, WaitReady, Http, strResponse
WaitReady = False

For i = 0 To 90
    WScript.Sleep 1000
    
    ' 尝试 HTTP 请求检测服务是否就绪
    On Error Resume Next
    Set Http = CreateObject("MSXML2.XMLHTTP")
    Http.Open "GET", Url & "/api/stats", False
    Http.SetTimeouts 1000, 1000, 1000, 1000
    Http.Send
    If Err.Number = 0 And Http.Status = 200 Then
        WaitReady = True
        Set Http = Nothing
        Exit For
    End If
    Err.Clear
    Set Http = Nothing
    On Error GoTo 0
Next

' ---- 4. 就绪后弹窗 ----
If WaitReady Then
    MsgBox "Chip Manager 已启动！" & vbCrLf & vbCrLf & _
           "  端口: " & Port & vbCrLf & _
           "  地址: " & Url & vbCrLf & vbCrLf & _
           "服务正在后台运行，关闭此窗口不影响服务。" & vbCrLf & _
           "如需停止，请关闭对应的命令行窗口或任务管理器中结束 node 进程。", _
           vbInformation + vbOKOnly, "Chip Manager - 已就绪"
Else
    MsgBox "启动超时（90秒内未检测到端口 " & Port & " 就绪）" & vbCrLf & vbCrLf & _
           "请手动检查服务是否正常启动，或查看日志。", _
           vbExclamation + vbOKOnly, "Chip Manager - 启动超时"
End If