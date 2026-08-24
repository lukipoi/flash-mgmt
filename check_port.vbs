' Chip Manager port checker
Dim Port, Url, Http, Ready
Port = 3080
Url = "http://localhost:" & Port
Ready = False

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

If Ready Then
    Call MsgBox("Chip Manager is running" & vbCrLf & vbCrLf & _
           "  Port: " & Port & vbCrLf & _
           "  URL: " & Url, 64, "Chip Manager - Running")
Else
    Call MsgBox("Chip Manager is NOT running" & vbCrLf & vbCrLf & _
           "  Port: " & Port & vbCrLf & _
           "  URL: " & Url & vbCrLf & vbCrLf & _
           "Please run start_dev.vbs first.", 48, "Chip Manager - Not Running")
End If