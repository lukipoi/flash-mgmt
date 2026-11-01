// 这是CH372和CH375的Windows98/ME/2000/XP简化版驱动程序, 仅供学习USB驱动开发
// 稍加修改完全可以用于其它USB芯片, 不过作者希望你是用于CH372和CH375芯片
// 2003.09.08, 2003.12.28, 2004.10.15, 2004.12.05, 2004.12.10, 2005.01.20, 2005.02.23, 2005.07.15
//****************************************
//**  Copyright  (C)  W.ch  1999-2005   **
//**  Web:  http://www.winchiphead.com  **
//****************************************
//**  DLL for USB interface chip CH375  **
//**  C, VC5.0                          **
//****************************************
//
// USB总线接口芯片CH375的应用层接口库  V0.1
// 南京沁恒电子有限公司  作者: W.ch 2005.07
// CH375-DLL  V0.1 , Support: Ctrl/Bulk/Int
// 运行环境: Windows 98/ME, Windows 2000/XP
// support USB chip: CH372/CH375
//

#include	<windows.h>
#include	<stdlib.h>
#include	<stdio.h>
#include	<conio.h>
#include	<setupapi.h>
#include	<winioctl.h>
#include	<dbt.h>

#include	"CH375DLL.H"

BOOL	WINAPI	DLLMain(  // 动态链接库的入口
	HINSTANCE	iInstance,
	ULONG		iReason,
	LPVOID		iReserved );


ULONG	WINAPI	dllInterruptThread(  // 中断模拟线程
	LPVOID		iParameter );


#define		mTHIS_VERSION			0x01				// 当前版本


static const GUID CH375Guid = { 0x5e7f6bdf, 0x1ce5, 0x4d78, { 0xbb, 0xcf, 0xd2, 0xc, 0x44, 0x32, 0x9f, 0x7d } };	// GUID


HANDLE				dllHandle;			// CH375设备句柄
mPCH375_INT_ROUTINE	dllIntRoutine;		// CH375中断服务回调程序
ULONG				dllIntThreadId;		// CH375中断模拟线程的标识符
UCHAR				dllDeviceName[128];	// CH375设备名字符串


BOOL	WINAPI	DLLMain(  // 动态链接库的入口
	HINSTANCE	iInstance,
	ULONG		iReason,
	LPVOID		iReserved )
{
	return( TRUE );
}

ULONG	WINAPI	dllInterruptThread(  // 中断模拟线程,每个需要中断功能的CH375设备都具有一个线程
	LPVOID		iParameter )
{
	HANDLE				dllHandleOverlap;	// CH375设备句柄,可以执行重叠操作
	HANDLE				mEvent;
	BOOL				mResult;
	ULONG				mLength;
	mWIN32_COMMAND		mCommand;
	OVERLAPPED			mOverlapped;
	mPCH375_INT_ROUTINE	mIntRoutine;
	dllHandleOverlap = CreateFile( (PUCHAR)iParameter, GENERIC_READ | GENERIC_WRITE,  // 打开设备,支持重叠操作
									FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, NULL );
	if ( dllHandleOverlap != INVALID_HANDLE_VALUE ) {  // 打开设备成功
		mEvent = CreateEvent( NULL, TRUE, FALSE, NULL );  // 初始化完成事件
		while ( dllIntRoutine ) {  // 等待中断直到取消
			mCommand.mFunction = mPipeInterUp;  // 从中断数据上传管道读取数据
			mCommand.mLength = mCH375_PKT_LEN_SHORT;  // 数据长度
			mLength = sizeof( mWIN32_COMMAND );  // 缓冲区长度,数据长度加上命令结构头的长度
			mOverlapped.Internal = 0;
			mOverlapped.InternalHigh = 0;
			mOverlapped.Offset = 0;
			mOverlapped.OffsetHigh = 0;
			mOverlapped.hEvent = mEvent;
			ResetEvent( mEvent );  // 初始化完成事件
			mResult = DeviceIoControl( dllHandleOverlap, IOCTL_CH375_COMMAND, &mCommand, mLength, &mCommand, mLength, &mLength, &mOverlapped );
			if ( mResult == FALSE && GetLastError() == ERROR_IO_PENDING )  // 操作未完成,即暂时无中断
				mResult = GetOverlappedResult( dllHandleOverlap, &mOverlapped, &mLength, TRUE );  // 等待中断
			if ( mResult ) {  // 发生中断事件则调用中断服务回调程序
				if ( mIntRoutine = dllIntRoutine ) mIntRoutine( & mCommand.mBuffer[0] );  // 发生中断事件则调用中断服务回调程序,将当前的中断特征数据提供给中断服务程序
			}
			if ( mResult == FALSE && dllIntRoutine ) Sleep( 5 );  // 出错则延时5毫秒
		}
		CloseHandle( mEvent );
		CloseHandle( dllHandleOverlap );  // 关闭句柄
	}
	dllIntThreadId = 0;
	ExitThread( 0 );  // 退出
	return( 0 );
}

ULONG	WINAPI	CH375GetVersion( )  // 获得DLL版本号,返回版本号
{
	return( mTHIS_VERSION );
}

PVOID	WINAPI	CH375GetDeviceName(  // 返回指向CH375设备名称的缓冲区,出错则返回NULL
	ULONG			iIndex )  // 指定CH375设备序号,0对应第一个设备
{
	UCHAR								mBuffer[1024];
	LPGUID								mClassGuid;
	HDEVINFO							mDevInfo;
	SP_INTERFACE_DEVICE_DATA			mDevIfData;
	PSP_INTERFACE_DEVICE_DETAIL_DATA	mDevIfDetail;
	mClassGuid = ( LPGUID )&CH375Guid;  // 设备类
	mDevInfo = SetupDiGetClassDevs( mClassGuid, NULL, NULL, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE );  // 获得指定设备类
	if ( mDevInfo == INVALID_HANDLE_VALUE ) return( NULL );
	mDevIfData.cbSize = sizeof( mDevIfData );
	if ( !SetupDiEnumDeviceInterfaces( mDevInfo, NULL, mClassGuid, iIndex, &mDevIfData ) ) {  // 枚举指定序号的设备
		SetupDiDestroyDeviceInfoList( mDevInfo );
		return( NULL );
	}
	mDevIfDetail = ( PSP_INTERFACE_DEVICE_DETAIL_DATA ) mBuffer;
	mDevIfDetail -> cbSize = sizeof( SP_INTERFACE_DEVICE_DETAIL_DATA );
	if ( !SetupDiGetDeviceInterfaceDetail( mDevInfo, &mDevIfData, mDevIfDetail, 1020, NULL, NULL ) ) {  // 获得设备详细信息
		SetupDiDestroyDeviceInfoList( mDevInfo );
		return( NULL );
	}
	lstrcpy( dllDeviceName, mDevIfDetail -> DevicePath );  // 设备名称
	SetupDiDestroyDeviceInfoList( mDevInfo );
	return( dllDeviceName );
}

HANDLE	WINAPI	CH375OpenDevice(  // 打开CH375设备,返回句柄,出错则无效
	ULONG			iIndex )  // 指定CH375设备序号,0对应第一个设备
{
	dllHandle = CreateFile( CH375GetDeviceName( iIndex ), GENERIC_READ | GENERIC_WRITE,  // 打开设备,不支持重叠操作
						FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL );  // 共享
	return( dllHandle );
}

VOID	WINAPI	CH375CloseDevice(  // 关闭CH375设备
	ULONG			iIndex )  // 指定CH375设备序号,必须是0
{
	dllIntRoutine = NULL;  // 取消中断服务程序
	if ( dllIntThreadId ) CH375SetIntRoutine( 0, NULL );  // 等待线程结束
	CloseHandle( dllHandle );  // 关闭句柄
}

ULONG	WINAPI	CH375DriverCommand(  // 直接传递命令给驱动程序,出错则返回0,否则返回数据长度
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	mPWIN32_COMMAND	ioCommand )  // 命令结构的指针
// 该程序在调用后返回数据长度,并且仍然返回命令结构,如果是读操作,则数据返回在命令结构中,
// 返回的数据长度在操作失败时为0,操作成功时为整个命令结构的长度,例如读一个字节,则返回mWIN32_COMMAND_HEAD+1,
// 命令结构在调用前,分别提供:管道号或者命令功能代码,存取数据的长度(可选),数据(可选)
// 命令结构在调用后,分别返回:操作状态代码,后续数据的长度(可选),
//   操作状态代码是由WINDOWS定义的代码,可以参考NTSTATUS.H,
//   后续数据的长度是指读操作返回的数据长度,数据存放在随后的缓冲区中,对于写操作一般为0
{
	ULONG	mLength;
	mLength = ioCommand -> mLength + mWIN32_COMMAND_HEAD;  // 数据缓冲区长度加上命令结构头的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, ioCommand, mLength, ioCommand, mLength, &mLength, NULL ) )
		return( mLength );  // 返回数据长度
	else return( 0 );  // 出错
}

BOOL	WINAPI	CH375GetDeviceDescr(  // 读取设备描述符
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	PVOID			oBuffer,  // 指向一个足够大的缓冲区,用于保存描述符
	PULONG			ioLength )  // 指向长度单元,输入时为准备读取的长度,返回后为实际读取的长度
{
	UCHAR			mBuffer[ mMAX_COMMAND_LENGTH ];
	ULONG			mLength;
	mPWIN32_COMMAND	mpCommand;
	if ( *ioLength > mMAX_BUFFER_LENGTH ) *ioLength = mMAX_BUFFER_LENGTH;  // 限制长度
	mpCommand = (PVOID)mBuffer;
	mpCommand -> mFunction = mPipeDeviceCtrl;  // 通过综合控制管道获取USB设备描述符
	mpCommand -> mLength = sizeof( mUSB_SETUP_PKT );  // 数据长度,指写入综合控制管道的命令请求包的长度
	mpCommand -> mSetupPkt.mUspReqType = 0x80;  // 请求类型
	mpCommand -> mSetupPkt.mUspRequest = 0x06;  // 请求码 USB_REQUEST_GET_DESCRIPTOR
	mpCommand -> mSetupPkt.mUspValueLow = 0x00;  // 描述符索引
	mpCommand -> mSetupPkt.mUspValueHigh = 0x01;  // 设备描述符 USB_DEVICE_DESCRIPTOR_TYPE
	mpCommand -> mSetupPkt.mUspIndex = 0x0000;  // 索引参数
	mpCommand -> mSetupPkt.mLength = (USHORT)*ioLength;  // 需要读取的数据长度
	mLength = *ioLength + mWIN32_COMMAND_HEAD;  // 缓冲区长度,数据长度加上命令结构头的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, mpCommand, sizeof( mWIN32_COMMAND ), mpCommand, mLength, &mLength, NULL ) ) {
		*ioLength = mpCommand -> mLength;  //  返回实际读取数据的长度
		CopyMemory( oBuffer, & mpCommand -> mBuffer[0], *ioLength );  // 返回读取的数据
		return( TRUE );
	}
	else {  // 出错
		*ioLength = 0;
		return( FALSE );
	}
}

BOOL	WINAPI	CH375GetConfigDescr(  // 读取配置描述符
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	PVOID			oBuffer,  // 指向一个足够大的缓冲区,用于保存描述符
	PULONG			ioLength )  // 指向长度单元,输入时为准备读取的长度,返回后为实际读取的长度
{
	UCHAR			mBuffer[ mMAX_COMMAND_LENGTH ];
	ULONG			mLength;
	mPWIN32_COMMAND	mpCommand;
	if ( *ioLength > mMAX_BUFFER_LENGTH ) *ioLength = mMAX_BUFFER_LENGTH;  // 限制长度
	mpCommand = (PVOID)mBuffer;
	mpCommand -> mFunction = mPipeDeviceCtrl;  // 通过综合控制管道获取USB设备描述符
	mpCommand -> mLength = sizeof( mUSB_SETUP_PKT );  // 数据长度,指写入综合控制管道的命令请求包的长度
	mpCommand -> mSetupPkt.mUspReqType = 0x80;  // 请求类型
	mpCommand -> mSetupPkt.mUspRequest = 0x06;  // 请求码 USB_REQUEST_GET_DESCRIPTOR
	mpCommand -> mSetupPkt.mUspValueLow = 0x00;  // 描述符索引
	mpCommand -> mSetupPkt.mUspValueHigh = 0x02;  // 设备描述符 USB_CONFIG_DESCRIPTOR_TYPE
	mpCommand -> mSetupPkt.mUspIndex = 0x0000;  // 索引参数
	mpCommand -> mSetupPkt.mLength = (USHORT)*ioLength;  // 需要读取的数据长度
	mLength = *ioLength + mWIN32_COMMAND_HEAD;  // 缓冲区长度,数据长度加上命令结构头的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, mpCommand, sizeof( mWIN32_COMMAND ), mpCommand, mLength, &mLength, NULL ) ) {
		*ioLength = mpCommand -> mLength;  //  返回实际读取数据的长度
		CopyMemory( oBuffer, & mpCommand -> mBuffer[0], *ioLength );  // 返回读取的数据
		return( TRUE );
	}
	else {  // 出错
		*ioLength = 0;
		return( FALSE );
	}
}

BOOL	WINAPI	CH375ReadData(  // 读取数据块
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	PVOID			oBuffer,  // 指向一个足够大的缓冲区,用于保存读取的数据
	PULONG			ioLength )  // 指向长度单元,输入时为准备读取的长度,返回后为实际读取的长度
{
	UCHAR			mBuffer[ mMAX_COMMAND_LENGTH ];
	ULONG			mLength;
	mPWIN32_COMMAND	mpCommand;
	if ( *ioLength > mMAX_BUFFER_LENGTH ) *ioLength = mMAX_BUFFER_LENGTH;  // 限制最大长度
	mpCommand = (PVOID)mBuffer;
	mpCommand -> mFunction = mPipeDataUp;  // 从数据块上传管道读取数据
	mpCommand -> mLength = max( *ioLength, mCH375_PACKET_LENGTH );  // 数据长度,不能小于CH375的数据包长度
	mLength = mpCommand -> mLength + mWIN32_COMMAND_HEAD;  // 缓冲区长度,数据长度加上命令结构头的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, mpCommand, mWIN32_COMMAND_HEAD, mpCommand, mLength, &mLength, NULL ) ) {
		*ioLength = min( mpCommand -> mLength, *ioLength );  //  返回实际读取数据的长度
		CopyMemory( oBuffer, & mpCommand -> mBuffer[0], *ioLength );  // 返回读取的数据
		return( TRUE );
	}
	else {  // 出错
		*ioLength = 0;
		return( FALSE );
	}
}

BOOL	WINAPI	CH375AbortRead(  // 放弃数据块读操作
	ULONG			iIndex )  // 指定CH375设备序号,必须是0
{
	ULONG			mLength;
	mWIN32_COMMAND	mCommand;
	mCommand.mFunction = mFuncAbortPipe;  // 取消指定的USB管道的数据操作
	mCommand.mLength = sizeof( ULONG );
	*(PULONG) & mCommand.mBuffer[0] = mPipeDataUp;  // 数据块上传管道
	mLength = sizeof( mWIN32_COMMAND );  // 缓冲区长度,默认命令结构的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, &mCommand, mLength, &mCommand, mLength, &mLength, NULL ) )
		return( TRUE );
	else return( FALSE );  // 出错
}

BOOL	WINAPI	CH375ResetRead(  // 复位数据块读操作
	ULONG			iIndex )  // 指定CH375设备序号,必须是0
{
	ULONG			mLength;
	mWIN32_COMMAND	mCommand;
	mCommand.mFunction = mFuncResetPipe;  // 复位指定的USB管道
	mCommand.mLength = sizeof( ULONG );
	*(PULONG) & mCommand.mBuffer[0] = mPipeDataUp;  // 数据块上传管道
	mLength = sizeof( mWIN32_COMMAND );  // 缓冲区长度,默认命令结构的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, &mCommand, mLength, &mCommand, mLength, &mLength, NULL ) )
		return( TRUE );
	else return( FALSE );  // 出错
}

BOOL	WINAPI	CH375WriteData(  // 写出数据块
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	PVOID			iBuffer,  // 指向一个缓冲区,放置准备写出的数据
	PULONG			ioLength )  // 指向长度单元,输入时为准备写出的长度,返回后为实际写出的长度
{
	UCHAR			mBuffer[ mMAX_COMMAND_LENGTH ];
	ULONG			mLength;
	mPWIN32_COMMAND	mpCommand;
	if ( *ioLength > mMAX_BUFFER_LENGTH ) *ioLength = mMAX_BUFFER_LENGTH;  // 限制最大长度
	mpCommand = (PVOID)mBuffer;
	mpCommand -> mFunction = mPipeDataDown;  // 向数据块下传管道写出数据
	mpCommand -> mLength = *ioLength;  // 数据长度
	CopyMemory( & mpCommand -> mBuffer[0], iBuffer, *ioLength );  // 准备写出的数据
	mLength = *ioLength + mWIN32_COMMAND_HEAD;  // 缓冲区长度,数据长度加上命令结构头的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, mpCommand, mLength, mpCommand, mWIN32_COMMAND_HEAD, &mLength, NULL ) ) {
		*ioLength = mpCommand -> mLength;  //  返回实际写出数据的长度
		return( TRUE );
	}
	else {  // 出错
		*ioLength = 0;
		return( FALSE );
	}
}

BOOL	WINAPI	CH375AbortWrite(  // 放弃数据块写操作
	ULONG			iIndex )  // 指定CH375设备序号,必须是0
{
	ULONG			mLength;
	mWIN32_COMMAND	mCommand;
	mCommand.mFunction = mFuncAbortPipe;  // 取消指定的USB管道的数据操作
	mCommand.mLength = sizeof( ULONG );
	*(PULONG) & mCommand.mBuffer[0] = mPipeDataDown;  // 数据块下传管道
	mLength = sizeof( mWIN32_COMMAND );  // 缓冲区长度,默认命令结构的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, &mCommand, mLength, &mCommand, mLength, &mLength, NULL ) )
		return( TRUE );
	else return( FALSE );  // 出错
}

BOOL	WINAPI	CH375ResetWrite(  // 复位数据块写操作
	ULONG			iIndex )  // 指定CH375设备序号,必须是0
{
	ULONG			mLength;
	mWIN32_COMMAND	mCommand;
	mCommand.mFunction = mFuncResetPipe;  // 复位指定的USB管道
	mCommand.mLength = sizeof( ULONG );
	*(PULONG) & mCommand.mBuffer[0] = mPipeDataDown;  // 数据块下传管道
	mLength = sizeof( mWIN32_COMMAND );  // 缓冲区长度,默认命令结构的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, &mCommand, mLength, &mCommand, mLength, &mLength, NULL ) )
		return( TRUE );
	else return( FALSE );  // 出错
}

BOOL	WINAPI	CH375ReadInter(  // 读取中断数据
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	PVOID			oBuffer,  // 指向一个足够大的缓冲区,用于保存读取的中断数据
	PULONG			ioLength )  // 指向长度单元,输入时为准备读取的长度,返回后为实际读取的长度
{
	UCHAR			mBuffer[ mMAX_COMMAND_LENGTH ];
	ULONG			mLength;
	mPWIN32_COMMAND	mpCommand;
	if ( *ioLength > mMAX_BUFFER_LENGTH ) *ioLength = mMAX_BUFFER_LENGTH;  // 限制长度
	mpCommand = (PVOID)mBuffer;
	mpCommand -> mFunction = mPipeInterUp;  // 从中断数据上传管道读取数据
	mpCommand -> mLength = max( *ioLength, mCH375_PKT_LEN_SHORT );  // 数据长度,不能小于CH375的数据包长度
	mLength = mpCommand -> mLength + mWIN32_COMMAND_HEAD;  // 缓冲区长度,数据长度加上命令结构头的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, mpCommand, mWIN32_COMMAND_HEAD, mpCommand, mLength, &mLength, NULL ) ) {
		*ioLength = min( mpCommand -> mLength, *ioLength );  //  返回实际读取数据的长度
		CopyMemory( oBuffer, & mpCommand -> mBuffer[0], *ioLength );  // 返回读取的数据
		return( TRUE );
	}
	else {  // 出错
		*ioLength = 0;
		return( FALSE );
	}
}

BOOL	WINAPI	CH375AbortInter(  // 放弃中断数据读操作
	ULONG			iIndex )  // 指定CH375设备序号,必须是0
{
	ULONG			mLength;
	mWIN32_COMMAND	mCommand;
	mCommand.mFunction = mFuncAbortPipe;  // 取消指定的USB管道的数据操作
	mCommand.mLength = sizeof( ULONG );
	*(PULONG) & mCommand.mBuffer[0] = mPipeInterUp;  // 中断数据上传管道
	mLength = sizeof( mWIN32_COMMAND );  // 缓冲区长度,默认命令结构的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, &mCommand, mLength, &mCommand, mLength, &mLength, NULL ) )
		return( TRUE );
	else return( FALSE );  // 出错
}

BOOL	WINAPI	CH375ResetInter(  // 复位中断数据读操作
	ULONG			iIndex )  // 指定CH375设备序号,必须是0
{
	ULONG			mLength;
	mWIN32_COMMAND	mCommand;
	mCommand.mFunction = mFuncResetPipe;  // 复位指定的USB管道
	mCommand.mLength = sizeof( ULONG );
	*(PULONG) & mCommand.mBuffer[0] = mPipeInterUp;  // 中断数据上传管道
	mLength = sizeof( mWIN32_COMMAND );  // 缓冲区长度,默认命令结构的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, &mCommand, mLength, &mCommand, mLength, &mLength, NULL ) )
		return( TRUE );
	else return( FALSE );  // 出错
}

BOOL	WINAPI	CH375SetIntRoutine(  // 设定中断服务程序
	ULONG				iIndex,  // 指定CH375设备序号,必须是0
	mPCH375_INT_ROUTINE	iIntRoutine )  // 指定中断服务回调程序,为NULL则取消中断服务,否则在中断时调用该程序
{
	HANDLE			mHandle;
	dllIntRoutine = NULL;
	while ( dllIntThreadId ) {  /* 已经创建线程 */
		CH375AbortInter( 0 );  // 放弃在此之前的等待中断,等待线程结束
		Sleep( 20 );  // 延时20毫秒
	}
	if ( iIntRoutine == NULL ) return( TRUE );  // 取消中断服务
	dllIntRoutine = iIntRoutine;
	mHandle = CreateThread( NULL, 0, dllInterruptThread, (PVOID)dllDeviceName, 0, & dllIntThreadId );  // 创建线程模拟中断事件
	if ( mHandle ) {  // 线程创建成功
		SetThreadPriority( mHandle, THREAD_PRIORITY_TIME_CRITICAL ); // 为了缩短中断服务回调程序响应时间,应该提高线程的优先级
		return ( TRUE );
	}
	else return ( FALSE );  // 操作成功
}

BOOL	WINAPI	CH375WriteAuxData(  // 写出辅助数据
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	PVOID			iBuffer,  // 指向一个缓冲区,放置准备写出的数据
	PULONG			ioLength )  // 指向长度单元,输入时为准备写出的长度,返回后为实际写出的长度
{
	UCHAR			mBuffer[ mMAX_COMMAND_LENGTH ];
	ULONG			mLength;
	mPWIN32_COMMAND	mpCommand;
	if ( *ioLength > mMAX_BUFFER_LENGTH ) *ioLength = mMAX_BUFFER_LENGTH;  // 限制最大长度
	mpCommand = (PVOID)mBuffer;
	mpCommand -> mFunction = mPipeAuxDown;  // 向辅助数据下传管道写出数据
	mpCommand -> mLength = *ioLength;  // 数据长度
	CopyMemory( & mpCommand -> mBuffer[0], iBuffer, *ioLength );  // 准备写出的数据
	mLength = *ioLength + mWIN32_COMMAND_HEAD;  // 缓冲区长度,数据长度加上命令结构头的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, mpCommand, mLength, mpCommand, mWIN32_COMMAND_HEAD, &mLength, NULL ) ) {
		*ioLength = mpCommand -> mLength;  //  返回实际写出数据的长度
		return( TRUE );
	}
	else {  // 出错
		*ioLength = 0;
		return( FALSE );
	}
}

BOOL	WINAPI	CH375ResetAux(  // 复位辅助数据写操作
	ULONG			iIndex )  // 指定CH375设备序号,必须是0
{
	ULONG			mLength;
	mWIN32_COMMAND	mCommand;
	mCommand.mFunction = mFuncResetPipe;  // 复位指定的USB管道
	mCommand.mLength = sizeof( ULONG );
	*(PULONG) & mCommand.mBuffer[0] = mPipeAuxDown;  // 辅助数据下传管道
	mLength = sizeof( mWIN32_COMMAND );  // 缓冲区长度,默认命令结构的长度
	if ( DeviceIoControl( dllHandle, IOCTL_CH375_COMMAND, &mCommand, mLength, &mCommand, mLength, &mLength, NULL ) )
		return( TRUE );
	else return( FALSE );  // 出错
}
