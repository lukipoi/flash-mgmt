' Chip Manager startup script
Dim WshShell, Port, Url
Port = 3080
Url = "http://localhost:" & Port

Call MsgBox("Starting Chip Manager dev server..." & vbCrLf & vbCrLf & _
       "  Port: " & Port & vbCrLf & _
       "  URL: " & Url, 48, "Chip Manager - Starting")

Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c d:\CH341-SPI\flash-mgmt\start_dev.bat", 0, False

Dim i, WaitReady, Http
WaitReady = False

For i = 0 To 90
    WScript.Sleep 1000
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

If WaitReady Then
    Call MsgBox("Chip Manager is running!" & vbCrLf & vbCrLf & _
           "  Port: " & Port & vbCrLf & _
           "  URL: " & Url & vbCrLf & vbCrLf & _
           "Server is running in background.", 64, "Chip Manager - Ready")
Else
    Call MsgBox("Timeout - server not ready on port " & Port, 16, "Chip Manager - Timeout")
End If