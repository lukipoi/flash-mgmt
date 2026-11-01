// 这是CH372和CH375的Windows98/ME/2000/XP简化版驱动程序, 仅供学习USB驱动开发
// 稍加修改完全可以用于其它USB芯片, 不过作者希望你是用于CH372和CH375芯片
// 2003.09.08, 2003.12.28, 2004.10.15, 2004.12.05, 2004.12.10, 2005.01.20, 2005.02.23, 2005.07.15
//****************************************
//**  Copyright  (C)  W.ch  1999-2005   **
//**  Web:  http://www.winchiphead.com  **
//****************************************
//**  WDM for USB interface chip CH375  **
//**  C, VC5.0, Windows 98 DDK          **
//****************************************
//
// USB总线接口芯片CH375的WDM驱动程序   V0.1
// 南京沁恒电子有限公司  作者: W.ch 2005.07
// CH375-WDM  V0.1 , Support: Ctrl/Bulk/Int
// 运行环境: Windows 98/ME, Windows 2000/XP
// support USB chip: CH372/CH375
//


#define		mTHIS_VERSION			0x01		// 当前版本
#define		mTHIS_VER_STR			"0.1"		// 当前版本字符串

#include	<wdm.h>
#include	<usbdi.h>
#include	<usbdlib.h>


#include	"CH375WDM.H"

typedef	struct	_DEVICE_EXTENSION {				// 定义设备扩展结构
	UNICODE_STRING		mExtDeviceName;			// 设备名称
	PDEVICE_OBJECT		mExtPhysicalTarget;		// 物理设备对象指针
	PDEVICE_OBJECT		mExtNextLowerDevice;	// 下级设备对象指针
	USBD_PIPE_HANDLE	mExtInterUpPipe;		// USB中断数据上传管道的句柄
	USBD_PIPE_HANDLE	mExtAuxDownPipe;		// USB辅助数据下传管道的句柄
	USBD_PIPE_HANDLE	mExtDataDownPipe;		// USB数据块下传管道的句柄
	USBD_PIPE_HANDLE	mExtDataUpPipe;			// USB数据块上传管道的句柄
	ULONG				mExtIoCount;			// 计数正在进行的操作,以阻止操作中途停止或者移除设备
	ULONG				mExtDeviceOpen;			// 指示设备被打开的次数
	BOOLEAN				mExtDeviceStart;		// 指示设备启动状态
	BOOLEAN				mExtDeviceRemove;		// 指示设备移除状态
} mDEVICE_EXTENSION, *mPDEVICE_EXTENSION;


// 驱动程序说明
UCHAR			mDescription[128] = " CH375 WDM V" mTHIS_VER_STR " "
									" Author : W.ch  "
									"HX.S065  2003.12\xd\xa"
									" www.wch99.com  \xd\xa"
									" Copyright (C) W.ch 1999-2005 \xd\xa\x0";

PDRIVER_OBJECT	mDriverObject = NULL;


// 子程序说明


NTSTATUS		DriverEntry( PDRIVER_OBJECT iDriverObject, PUNICODE_STRING iRegistryPath );
VOID			mDriverUnload( PDRIVER_OBJECT iDriverObject );
NTSTATUS		mAddDevice( PDRIVER_OBJECT iDriverObject, PDEVICE_OBJECT iPhysicalDeviceObject );
VOID			mRemoveDevice( PDEVICE_OBJECT iDeviceObject );
NTSTATUS		mDispatchCreate( PDEVICE_OBJECT iDeviceObject, PIRP iIrp );
NTSTATUS		mDispatchClose( PDEVICE_OBJECT iDeviceObject, PIRP iIrp );
NTSTATUS		mDispatchDeviceControl( PDEVICE_OBJECT iDeviceObject, PIRP iIrp );
NTSTATUS		mRequestPipe( PDEVICE_OBJECT iDeviceObject, USHORT iFunction, ULONG iPipe );
NTSTATUS		mDispatchCleanup( PDEVICE_OBJECT iDeviceObject, PIRP iIrp );
NTSTATUS		mDispatchPower( PDEVICE_OBJECT iDeviceObject, PIRP iIrp );
NTSTATUS		mDispatchSystemControl( PDEVICE_OBJECT iDeviceObject, PIRP iIrp );
NTSTATUS		mDispatchPnp( PDEVICE_OBJECT iDeviceObject, PIRP iIrp );
NTSTATUS		mWaitCompletion( PDEVICE_OBJECT iDeviceObject, PIRP iIrp );
NTSTATUS		mCompletionRoutine( PDEVICE_OBJECT iDeviceObject, PIRP iIrp, PVOID iContext );
NTSTATUS		mActiveConfig( PDEVICE_OBJECT iDeviceObject, PIRP iIrp );
NTSTATUS		mDeactiveConfig( PDEVICE_OBJECT iDeviceObject, PIRP iIrp );
NTSTATUS		mUsbSubmitUrb( PDEVICE_OBJECT iDeviceObject, PURB iUrb );


#ifdef		ALLOC_PRAGMA
#pragma		alloc_text( INIT, DriverEntry )
#endif


NTSTATUS	DriverEntry(  // 驱动程序初始化入口
	PDRIVER_OBJECT	iDriverObject,  // 驱动程序对象
	PUNICODE_STRING	iRegistryPath )
{
	mDriverObject = iDriverObject;  // 保存驱动程序对象
//	while ( mDriverObject );  // 调试
	iDriverObject -> MajorFunction[ IRP_MJ_CREATE ] = mDispatchCreate;  // 创建或者打开设备
	iDriverObject -> MajorFunction[ IRP_MJ_CLOSE ] = mDispatchClose;  // 关闭设备
	iDriverObject -> MajorFunction[ IRP_MJ_DEVICE_CONTROL ] = mDispatchDeviceControl;  // 设备控制
	iDriverObject -> MajorFunction[ IRP_MJ_CLEANUP ] = mDispatchCleanup;  // 取消操作
	iDriverObject -> MajorFunction[ IRP_MJ_POWER ] = mDispatchPower;  // 电源管理
	iDriverObject -> MajorFunction[ IRP_MJ_SYSTEM_CONTROL ] = mDispatchSystemControl;  // 系统WMI接口
	iDriverObject -> MajorFunction[ IRP_MJ_PNP ] = mDispatchPnp;  // 设备PnP操作
	iDriverObject -> DriverUnload = mDriverUnload;  // 卸载驱动程序
	iDriverObject -> DriverExtension -> AddDevice = mAddDevice;  // 检测到新硬件设备
	return( STATUS_SUCCESS );
}

VOID		mDriverUnload(  // 卸载驱动程序
	PDRIVER_OBJECT	iDriverObject )
{
	mDriverObject = NULL;  // 清除驱动程序对象,指示系统线程终止
}

NTSTATUS	mAddDevice(  // 添加新设备的PnP例程
	PDRIVER_OBJECT	iDriverObject,  // 驱动程序对象
	PDEVICE_OBJECT	iPhysicalDeviceObject )
{
	PDEVICE_OBJECT		mDeviceObject = NULL;
	mPDEVICE_EXTENSION	mDeviceExtension;
	NTSTATUS			mStatus = STATUS_INSUFFICIENT_RESOURCES;
	__try {  // 确保退出前的处理
		mStatus = IoCreateDevice( iDriverObject, sizeof( mDEVICE_EXTENSION ), NULL,  // 创建设备对象
								  FILE_DEVICE_UNKNOWN, 0, FALSE, &mDeviceObject );  // 返回的设备对象
		if ( ! NT_SUCCESS( mStatus ) ) __leave;  // 创建设备失败
		mDeviceExtension = mDeviceObject -> DeviceExtension;  // 设备扩展指针
		RtlZeroMemory( mDeviceExtension, sizeof( mDEVICE_EXTENSION ) );  // 清除内存
		mDeviceExtension -> mExtPhysicalTarget = iPhysicalDeviceObject;  // 物理设备的功能设备对象
		mDeviceExtension -> mExtIoCount = 0;  // 清操作计数
		mDeviceExtension -> mExtDeviceOpen = 0;  // 清除设备打开标志
		mDeviceExtension -> mExtDeviceStart = FALSE;  // 清除设备启动标志
		mDeviceExtension -> mExtDeviceRemove = FALSE;  // 清除设备移除标志
		mDeviceExtension -> mExtNextLowerDevice = IoAttachDeviceToDeviceStack( mDeviceObject,  // 挂接设备栈,返回下级设备
																			   iPhysicalDeviceObject );  // 指向物理对象
		if ( mDeviceExtension -> mExtNextLowerDevice == NULL ) {  // 挂接设备栈失败
			mStatus = STATUS_UNSUCCESSFUL;  // 返回错误信息
			__leave;
		}
		mStatus = IoRegisterDeviceInterface( iPhysicalDeviceObject, &CH375Guid,  // 注册设备接口
											 NULL, & mDeviceExtension -> mExtDeviceName );  // 保存符号链接名称
		mDeviceObject -> Flags |= DO_BUFFERED_IO | DO_POWER_PAGABLE;  // 缓冲IO,指示代码可能在分页内存中
		mDeviceObject -> Flags &= ~DO_DEVICE_INITIALIZING;  // 初始化完成
	}
	__finally {  // 退出前的处理
		if ( ! NT_SUCCESS( mStatus ) ) {  // 初始化失败
			mRemoveDevice( mDeviceObject );  // 移除设备
		}
	}
	return( STATUS_SUCCESS );
}

VOID		mRemoveDevice(  // 移除设备
	PDEVICE_OBJECT	iDeviceObject )
{
	ULONG				mDeviceInstance;
	mPDEVICE_EXTENSION	mDeviceExtension;
	if ( iDeviceObject == NULL ) return;  // 设备对象无效
	mDeviceExtension = iDeviceObject -> DeviceExtension;  // 设备扩展
	if ( mDeviceExtension -> mExtDeviceName.Buffer != NULL ) {  // 已经注册设备接口
		IoSetDeviceInterfaceState( & mDeviceExtension -> mExtDeviceName, FALSE );  // 禁用设备接口
		RtlFreeUnicodeString( & mDeviceExtension -> mExtDeviceName );  // 释放设备名称缓冲区
		mDeviceExtension -> mExtDeviceName.Buffer = NULL;
	}
	if ( mDeviceExtension -> mExtNextLowerDevice != NULL ) {  // 已经挂接到设备栈
		IoDetachDevice( mDeviceExtension -> mExtNextLowerDevice );  // 撤出设备栈
		mDeviceExtension -> mExtNextLowerDevice = NULL;
	}
	IoDeleteDevice( iDeviceObject );  // 删除设备对象
}

NTSTATUS	mDispatchCreate(  // 新建或者打开
	PDEVICE_OBJECT	iDeviceObject,
	PIRP			iIrp )
{
	mPDEVICE_EXTENSION	mDeviceExtension = iDeviceObject -> DeviceExtension;  // 设备扩展
	iIrp -> IoStatus.Information = 0;
	InterlockedIncrement( & mDeviceExtension -> mExtDeviceOpen );  // 打开计数增量
	iIrp -> IoStatus.Status = STATUS_SUCCESS;  // 返回操作状态
	IoCompleteRequest( iIrp, IO_NO_INCREMENT );  // 完成请求
	return( STATUS_SUCCESS );  // 返回状态
}

NTSTATUS	mDispatchClose(  // 关闭
	PDEVICE_OBJECT	iDeviceObject,
	PIRP			iIrp )
{
	mPDEVICE_EXTENSION	mDeviceExtension = iDeviceObject -> DeviceExtension;  // 设备扩展
	InterlockedDecrement( & mDeviceExtension -> mExtDeviceOpen );  // 关闭则打开计数减量
	iIrp -> IoStatus.Status = STATUS_SUCCESS;  // 返回操作状态
	iIrp -> IoStatus.Information = 0;
	IoCompleteRequest( iIrp, IO_NO_INCREMENT );  // 完成请求
	return( STATUS_SUCCESS );  // 返回状态
}

NTSTATUS	mDispatchDeviceControl(  // 设备控制
	PDEVICE_OBJECT	iDeviceObject,
	PIRP			iIrp )
{
	UCHAR				mRequestType, mRequestCode;
	USHORT				mRequestValue, mRequestIndex;
	ULONG				mControlCode;
	ULONG				mFunction, mLength, mReturn;
	ULONG				mTransferFlags, mParameter;
	PVOID				mBuffer;
	mPWIN32_COMMAND		mWin32Command;
	NTSTATUS			mStatus;
	PURB				mUrb;
	PIO_STACK_LOCATION	mCurrentIrpStack;
	mPDEVICE_EXTENSION	mDeviceExtension = iDeviceObject -> DeviceExtension;  // 设备扩展
	InterlockedIncrement( & mDeviceExtension -> mExtIoCount );  // 操作计数增量,阻止中途停止或者移除设备
	mCurrentIrpStack = IoGetCurrentIrpStackLocation( iIrp );  // 当前栈单元指针
	mControlCode = mCurrentIrpStack -> Parameters.DeviceIoControl.IoControlCode;  // 操作命令
	if ( mControlCode == IOCTL_CH375_COMMAND ) {  // 专用接口
		mStatus = STATUS_SUCCESS;  // 返回状态预置为成功
		mReturn = 0;  // 返回数据长度预置为0
		mUrb = ExAllocatePool( NonPagedPool, sizeof( URB ) );  // 分配内存作为URB请求块
		if (  mUrb != NULL && mCurrentIrpStack -> Parameters.DeviceIoControl.InputBufferLength >= mWIN32_COMMAND_HEAD ) {  // 输入缓冲区长度有效
			mWin32Command = iIrp -> AssociatedIrp.SystemBuffer;  // 命令缓冲区
			mFunction = mWin32Command -> mFunction;  // 功能代码
			mLength = mWin32Command -> mLength;  // 存取长度
			mBuffer = & mWin32Command -> mBuffer[0];  // 数据缓冲区
			switch( mFunction ) {  // 分析功能代码
				case mFuncGetVersion:  // 获取版本号
					while ( mLength >= sizeof( ULONG ) && *(PULONG)mBuffer == 'hc.W' );  // 等待调试工具W.ch
					*(PUCHAR)mBuffer = mTHIS_VERSION;  // 驱动程序版本号
					mReturn = sizeof( UCHAR );  // 返回数据长度
					break;
				case mPipeDeviceCtrl:  // CH375的综合控制管道
					mRequestType = mWin32Command -> mSetupPkt.mUspReqType;  // 请求类型
					mRequestCode = mWin32Command -> mSetupPkt.mUspRequest;  // 请求码
					mRequestValue = mWin32Command -> mSetupPkt.mUspValue;  // 数值参数
					mRequestIndex = mWin32Command -> mSetupPkt.mUspIndex;  // 索引参数
					mLength = mWin32Command -> mSetupPkt.mLength;  // 后续操作的数据长度
					mTransferFlags = ( ( mRequestType & 0x80 ) != 0 ? USBD_TRANSFER_DIRECTION_IN : 0 ) | USBD_SHORT_TRANSFER_OK;  // 传输标志
					switch( mRequestType >> 5 & 0x03 ) {  // 分析请求类型
						case 0:  // 标准请求
							switch( mRequestCode ) {  // 分析请求码
								case USB_REQUEST_GET_DESCRIPTOR:  // 获取描述符
									mParameter = ( mRequestValue >> 8 ) == 1 ? USB_DEVICE_DESCRIPTOR_TYPE : USB_CONFIGURATION_DESCRIPTOR_TYPE;  // 描述符类型
									UsbBuildGetDescriptorRequest( mUrb, sizeof( struct _URB_CONTROL_DESCRIPTOR_REQUEST ),  // 构造获取描述符URB
																  (UCHAR)mParameter, 0, 0, mBuffer, NULL, mLength, NULL );
									mStatus = mUsbSubmitUrb( iDeviceObject, mUrb );  // 提交URB
									mReturn = mUrb -> UrbControlDescriptorRequest.TransferBufferLength;  // 实际传输长度
									break;
								default:  // 不支持
									mStatus = STATUS_INVALID_PARAMETER;  // 返回错误
									break;
							}
							break;
						default:  // 不支持的请求
							mStatus = STATUS_INVALID_PARAMETER;  // 返回错误
							break;
					}
					break;
				case mPipeInterUp:  // CH375的中断数据上传管道
					if ( mDeviceExtension -> mExtInterUpPipe != NULL ) {  // 管道有效
						mTransferFlags = USBD_TRANSFER_DIRECTION_IN | USBD_SHORT_TRANSFER_OK;  // 传输标志
						UsbBuildInterruptOrBulkTransferRequest( mUrb, sizeof( struct _URB_BULK_OR_INTERRUPT_TRANSFER ),  // 构造USB请求
																mDeviceExtension -> mExtInterUpPipe,  // 管道的句柄
																mBuffer, NULL, mLength, mTransferFlags, NULL );  // 操作标志
						mStatus = mUsbSubmitUrb( iDeviceObject, mUrb );  // 提交URB
						mReturn = mUrb -> UrbBulkOrInterruptTransfer.TransferBufferLength;  // 实际传输长度
						if ( ! NT_SUCCESS( mStatus ) ) mRequestPipe( iDeviceObject, URB_FUNCTION_RESET_PIPE, mPipeInterUp );  // 出错则复位管道
					}
					else mStatus = STATUS_NO_SUCH_DEVICE ;  // 管道无效,设备无效
					break;
				case mPipeAuxDown:  // CH375的辅助数据下传管道
					if ( mDeviceExtension -> mExtAuxDownPipe != NULL ) {  // 管道有效
						mTransferFlags = USBD_SHORT_TRANSFER_OK;  // 传输标志
						UsbBuildInterruptOrBulkTransferRequest( mUrb, sizeof( struct _URB_BULK_OR_INTERRUPT_TRANSFER ),  // 构造USB请求
																mDeviceExtension -> mExtAuxDownPipe,  // 管道的句柄
																mBuffer, NULL, mLength, mTransferFlags, NULL );  // 操作标志
						mStatus = mUsbSubmitUrb( iDeviceObject, mUrb );  // 提交URB
						mReturn = mUrb -> UrbBulkOrInterruptTransfer.TransferBufferLength;  // 实际传输长度
						if ( ! NT_SUCCESS( mStatus ) ) mRequestPipe( iDeviceObject, URB_FUNCTION_RESET_PIPE, mPipeAuxDown );  // 出错则复位管道
					}
					else mStatus = STATUS_NO_SUCH_DEVICE ;  // 管道无效,设备无效
					break;
				case mPipeDataUp:  // CH375的数据块上传管道
					if ( mDeviceExtension -> mExtDataUpPipe != NULL ) {  // 管道有效
						mTransferFlags = USBD_TRANSFER_DIRECTION_IN | USBD_SHORT_TRANSFER_OK;  // 传输标志
						UsbBuildInterruptOrBulkTransferRequest( mUrb, sizeof( struct _URB_BULK_OR_INTERRUPT_TRANSFER ),  // 构造USB请求
																mDeviceExtension -> mExtDataUpPipe,  // 管道的句柄
																mBuffer, NULL, mLength, mTransferFlags, NULL );  // 操作标志
						mStatus = mUsbSubmitUrb( iDeviceObject, mUrb );  // 提交URB
						mReturn = mUrb -> UrbBulkOrInterruptTransfer.TransferBufferLength;  // 实际传输长度
						if ( ! NT_SUCCESS( mStatus ) ) mRequestPipe( iDeviceObject, URB_FUNCTION_RESET_PIPE, mPipeDataUp );  // 出错则复位管道
					}
					else mStatus = STATUS_NO_SUCH_DEVICE ;  // 管道无效,设备无效
					break;
				case mPipeDataDown:  // CH375的数据块下传管道
					if ( mDeviceExtension -> mExtDataDownPipe != NULL ) {  // 管道有效
						mTransferFlags = USBD_SHORT_TRANSFER_OK;  // 传输标志
						UsbBuildInterruptOrBulkTransferRequest( mUrb, sizeof( struct _URB_BULK_OR_INTERRUPT_TRANSFER ),  // 构造USB请求
																mDeviceExtension -> mExtDataDownPipe,  // 管道的句柄
																mBuffer, NULL, mLength, mTransferFlags, NULL );  // 操作标志
						mStatus = mUsbSubmitUrb( iDeviceObject, mUrb );  // 提交URB
						mReturn = mUrb -> UrbBulkOrInterruptTransfer.TransferBufferLength;  // 实际传输长度
						if ( ! NT_SUCCESS( mStatus ) ) mRequestPipe( iDeviceObject, URB_FUNCTION_RESET_PIPE, mPipeDataDown );  // 出错则复位管道
					}
					else mStatus = STATUS_NO_SUCH_DEVICE ;  // 管道无效,设备无效
					break;
				case mFuncResetPipe:  // 复位USB管道
					mStatus = mRequestPipe( iDeviceObject, URB_FUNCTION_RESET_PIPE, *(PULONG)mBuffer );  // 在指定管道执行复位请求
					break;
				case mFuncAbortPipe:  // 取消USB管道的数据请求
					mStatus = mRequestPipe( iDeviceObject, URB_FUNCTION_ABORT_PIPE, *(PULONG)mBuffer );  // 在指定管道执行取消请求
					break;
				default:  // 不支持的请求
					mStatus = STATUS_INVALID_PARAMETER;  // 返回错误
					break;
			}
			mWin32Command -> mStatus = mStatus;  // 返回操作状态
			mWin32Command -> mLength = mReturn;  // 实际传输长度
			mReturn += mWIN32_COMMAND_HEAD;  // 加上头部长度得返回数据的总长度
		}
		else {  // 失败
			if ( mUrb == NULL ) mStatus = STATUS_INSUFFICIENT_RESOURCES;  // 资源不够
			else mStatus = STATUS_BUFFER_TOO_SMALL;  // 缓冲区太小
		}
		if ( mUrb != NULL ) ExFreePool( mUrb );  // 释放内存
		if ( mStatus != STATUS_PENDING ) {  // 成功返回或者失败返回
			iIrp -> IoStatus.Status = mStatus;  // 返回状态
			iIrp -> IoStatus.Information = mReturn;  // 返回数据的长度
			IoCompleteRequest( iIrp, 4 );
		}
	}
	else {  // 直接传送至下级设备处理
		IoSkipCurrentIrpStackLocation( iIrp );  // 直接传送当前栈
		mStatus = IoCallDriver( mDeviceExtension -> mExtNextLowerDevice, iIrp );  // 传送至下级设备
	}
	InterlockedDecrement( & mDeviceExtension -> mExtIoCount );  // 操作计数减量
	return( mStatus );
}

NTSTATUS	mRequestPipe(  // 在指定管道上执行请求
	PDEVICE_OBJECT	iDeviceObject,
	USHORT			iFunction,
	ULONG			iPipe )
{
	PURB				mUrb;
	NTSTATUS			mStatus;
	ULONG				mPortStatus;
	mPDEVICE_EXTENSION	mDeviceExtension = iDeviceObject -> DeviceExtension;  // 设备扩展
	mUrb = ExAllocatePool( NonPagedPool, sizeof( URB ) );  // 分配内存作为URB请求块
	if ( mUrb == NULL ) return( STATUS_INSUFFICIENT_RESOURCES );  // 资源不够
	mUrb -> UrbHeader.Length = sizeof( struct _URB_PIPE_REQUEST );
	mUrb -> UrbHeader.Function = iFunction;
	switch( iPipe ) {  // 指定管道
		case mPipeInterUp:  // CH375的中断数据上传管道
			mUrb -> UrbPipeRequest.PipeHandle = mDeviceExtension -> mExtInterUpPipe;
			break;
		case mPipeAuxDown:  // CH375的辅助数据下传管道
			mUrb -> UrbPipeRequest.PipeHandle = mDeviceExtension -> mExtAuxDownPipe;
			break;
		case mPipeDataUp:  // CH375的数据块上传管道
			mUrb -> UrbPipeRequest.PipeHandle = mDeviceExtension -> mExtDataUpPipe;
			break;
		case mPipeDataDown:  // CH375的数据块下传管道
			mUrb -> UrbPipeRequest.PipeHandle = mDeviceExtension -> mExtDataDownPipe;
			break;
		default:  // 不支持
			mUrb -> UrbPipeRequest.PipeHandle = NULL;  // 管道无效
			break;
	}
	if ( mUrb -> UrbPipeRequest.PipeHandle == NULL ) mStatus = STATUS_NO_SUCH_DEVICE ;  // 管道无效
	else mStatus = mUsbSubmitUrb( iDeviceObject, mUrb );  // 提交URB
	ExFreePool( mUrb );  // 释放内存
	return( mStatus );
}

NTSTATUS	mDispatchCleanup(  // 取消操作
	PDEVICE_OBJECT	iDeviceObject,
	PIRP			iIrp )
{
	ULONG				i;
	ULONG				mPortStatus;
	mPDEVICE_EXTENSION	mDeviceExtension = iDeviceObject -> DeviceExtension;  // 设备扩展
	if ( mDeviceExtension -> mExtIoCount != 0 ) {  // 有未完成的操作请求
		mRequestPipe( iDeviceObject, URB_FUNCTION_ABORT_PIPE, mPipeDataDown );  // 在下传管道执行取消请求
		mRequestPipe( iDeviceObject, URB_FUNCTION_ABORT_PIPE, mPipeDataUp );  // 在上传管道执行取消请求
		mRequestPipe( iDeviceObject, URB_FUNCTION_ABORT_PIPE, mPipeInterUp );  // 取消请求
	}
	iIrp -> IoStatus.Status = STATUS_SUCCESS;  // 返回成功
	iIrp -> IoStatus.Information = 0;
	IoCompleteRequest( iIrp, IO_NO_INCREMENT );  // 完成请求
	return( STATUS_SUCCESS );  // 返回状态
}

NTSTATUS	mDispatchPower(  // 电源管理
	PDEVICE_OBJECT	iDeviceObject,
	PIRP			iIrp )
{
	mPDEVICE_EXTENSION	mDeviceExtension = iDeviceObject -> DeviceExtension;  // 设备扩展
	PoStartNextPowerIrp( iIrp );  // 开始下一个操作
	IoSkipCurrentIrpStackLocation( iIrp );  // 直接传送当前栈
	return( PoCallDriver( mDeviceExtension -> mExtNextLowerDevice, iIrp ) );  // 传送至下级设备
}

NTSTATUS	mDispatchSystemControl(  // 系统WMI控制
	PDEVICE_OBJECT	iDeviceObject,
	PIRP			iIrp )
{
	mPDEVICE_EXTENSION	mDeviceExtension = iDeviceObject -> DeviceExtension;  // 设备扩展
	IoSkipCurrentIrpStackLocation( iIrp );  // 直接传送当前栈
	return( IoCallDriver( mDeviceExtension -> mExtNextLowerDevice, iIrp ) );  // 传送至下级设备
}

NTSTATUS	mDispatchPnp(  // 即插即用
	PDEVICE_OBJECT	iDeviceObject,
	PIRP			iIrp )
{
	ULONG				i, mCompletion;  // 0:下传, 1:完成, 2:返回状态
	NTSTATUS			mStatus;
	PDEVICE_OBJECT		mNextDeviceObject;
	mPDEVICE_EXTENSION	mDeviceExtension = iDeviceObject -> DeviceExtension;  // 设备扩展
	mNextDeviceObject = mDeviceExtension -> mExtNextLowerDevice ;
	mCompletion = 0;  // 预置为下传
	switch( IoGetCurrentIrpStackLocation( iIrp ) -> MinorFunction ) {  // 检查PnP子功能代码
		case IRP_MN_START_DEVICE:  // 启动设备
			mStatus = mWaitCompletion( iDeviceObject, iIrp );  // 等待IRP完成
			if ( NT_SUCCESS( mStatus ) ) {  // 设备启动完成
				mStatus = mActiveConfig( iDeviceObject, iIrp );  // 设备启动完成则激活配置
				if ( NT_SUCCESS( mStatus ) ) {  // 设备配置完成
					mDeviceExtension -> mExtDeviceStart = TRUE;  // 置设备启动标志
					mDeviceExtension -> mExtDeviceRemove = FALSE;  // 清设备移除标志
					IoSetDeviceInterfaceState( & mDeviceExtension -> mExtDeviceName, TRUE );  // 允许设备接口
				}
			}
			mCompletion = 1;  // 操作已经完成
			break;
		case IRP_MN_QUERY_STOP_DEVICE:  // 将要停止设备
			if ( mDeviceExtension -> mExtIoCount != 0 ) {  // 当前正在操作
				mStatus = STATUS_UNSUCCESSFUL;  // 无法停止,操作失败
				iIrp -> IoStatus.Information = 0;
				mCompletion = 1;  // 强制操作完成
			}
			else mDeviceExtension -> mExtDeviceStart = FALSE;  // 清除设备启动标志
			break;
		case IRP_MN_CANCEL_STOP_DEVICE:  // 取消停止设备
			mDeviceExtension -> mExtDeviceStart = TRUE;  // 恢复设备启动标志
			break;
		case IRP_MN_STOP_DEVICE:  // 停止设备
			mDeviceExtension -> mExtDeviceStart = FALSE;  // 清除设备启动标志
			mDeactiveConfig( iDeviceObject, iIrp );  // 去除配置
			break;
		case IRP_MN_QUERY_REMOVE_DEVICE:  // 将要移除设备
			if ( mDeviceExtension -> mExtDeviceOpen != 0 ||  // 打开计数不为0则尚未关闭
				 mDeviceExtension -> mExtIoCount != 0 ) {  // 或者当前正在操作
				mStatus = STATUS_UNSUCCESSFUL;  // 无法移除,操作失败
				iIrp -> IoStatus.Information = 0;
				mCompletion = 1;  // 强制操作完成
			}
			else {  // 尚未打开且设备空闲
				mDeviceExtension -> mExtDeviceRemove = TRUE;  // 置设备移除标志
				IoSetDeviceInterfaceState( & mDeviceExtension -> mExtDeviceName, FALSE );  // 禁用设备接口
			}
			break;
		case IRP_MN_CANCEL_REMOVE_DEVICE:  // 取消移除设备
			mDeviceExtension -> mExtDeviceRemove = FALSE;  // 清设备移除标志
			IoSetDeviceInterfaceState( & mDeviceExtension -> mExtDeviceName, TRUE );  // 恢复设备接口
			break;
		case IRP_MN_SURPRISE_REMOVAL:  // 意外地移除设备
			mDeviceExtension -> mExtDeviceRemove = TRUE;  // 置设备移除标志
			IoSetDeviceInterfaceState( & mDeviceExtension -> mExtDeviceName, FALSE );  // 禁用设备接口
			break;
		case IRP_MN_REMOVE_DEVICE:  // 移除设备
			mDeviceExtension -> mExtDeviceRemove = TRUE;  // 置设备移除标志
			IoSetDeviceInterfaceState( & mDeviceExtension -> mExtDeviceName, FALSE );  // 禁用设备接口
			mDeviceExtension -> mExtDeviceStart = FALSE;  // 清除设备启动标志
			mRequestPipe( iDeviceObject, URB_FUNCTION_ABORT_PIPE, mPipeAuxDown );  // 在辅助下传管道执行取消请求
			mRequestPipe( iDeviceObject, URB_FUNCTION_ABORT_PIPE, mPipeDataDown );  // 在下传管道执行取消请求
			mRequestPipe( iDeviceObject, URB_FUNCTION_ABORT_PIPE, mPipeDataUp );  // 在上传管道执行取消请求
			mDeactiveConfig( iDeviceObject, iIrp );  // 去除配置
			mRemoveDevice( iDeviceObject );  // 移除设备操作
			break;
		default:
			break;
	}
	if ( mCompletion == 0 ) {  // 操作尚未完成则继续下传
		IoSkipCurrentIrpStackLocation( iIrp );  // 直接传送当前栈
		mStatus = IoCallDriver( mNextDeviceObject, iIrp );  // 传送至下级设备
	}
	else if ( mCompletion == 1 ) {  // 操作已经完成
		iIrp -> IoStatus.Status = mStatus;  // 置完成状态
		IoCompleteRequest( iIrp, IO_NO_INCREMENT );  // 完成当前IRP
	}
	return( mStatus );
}

NTSTATUS	mWaitCompletion(  // 等待IRP操作完成
	PDEVICE_OBJECT	iDeviceObject,
	PIRP			iIrp )
{
	KEVENT				mEvent;
	NTSTATUS			mStatus;
	mPDEVICE_EXTENSION	mDeviceExtension = iDeviceObject -> DeviceExtension;  // 设备扩展
	KeInitializeEvent( &mEvent, NotificationEvent, FALSE );  // 初始化IRP完成事件为无效
	IoCopyCurrentIrpStackLocationToNext( iIrp );  // 复制当前栈单元
	IoSetCompletionRoutine( iIrp, mCompletionRoutine, &mEvent, TRUE, TRUE, TRUE );  // 设置设定完成例程
	mStatus = IoCallDriver( mDeviceExtension -> mExtNextLowerDevice, iIrp );  // 传送至下级设备
	if ( mStatus == STATUS_PENDING ) {  // 等待被悬挂的IO请求完成
		KeWaitForSingleObject( &mEvent, Executive, KernelMode, FALSE, NULL );  // 挂起等待IRP完成
		mStatus = iIrp -> IoStatus.Status;  // 取完成状态
	}
	return( mStatus );  // 返回状态
}

NTSTATUS	mCompletionRoutine(  // 操作完成例程
	PDEVICE_OBJECT	iDeviceObject,
	PIRP			iIrp,
	PVOID			iContext )  // 输入参数,完成事件
{
	KeSetEvent( (PKEVENT)iContext, IO_NO_INCREMENT, FALSE );  // 置操作完成事件
	return( STATUS_MORE_PROCESSING_REQUIRED );  // 阻止继续处理当前IRP
}

NTSTATUS	mActiveConfig(  // 激活配置
	PDEVICE_OBJECT	iDeviceObject,
	PIRP			iIrp )
{
	ULONG							i;
	PURB							mUrb;
	NTSTATUS						mStatus;
	PUSB_CONFIGURATION_DESCRIPTOR	mConfigDescriptor;
	PUSB_INTERFACE_DESCRIPTOR		mInterfaceDescriptor;
	USBD_INTERFACE_LIST_ENTRY		mInterfaceList[2];
	PUSBD_INTERFACE_INFORMATION		mInterface;
	PUSBD_PIPE_INFORMATION			mPipe;
	mPDEVICE_EXTENSION				mDeviceExtension = iDeviceObject -> DeviceExtension;  // 设备扩展
	mStatus = STATUS_INSUFFICIENT_RESOURCES;  // 预置操作失败
	mDeviceExtension -> mExtInterUpPipe = NULL;
	mDeviceExtension -> mExtAuxDownPipe = NULL;
	mDeviceExtension -> mExtDataUpPipe = NULL;
	mDeviceExtension -> mExtDataDownPipe = NULL;
	mConfigDescriptor = ExAllocatePool( NonPagedPool,  // 分配内存作为配置描述符区域和URB请求块
										256 + sizeof( URB ) );
	if ( mConfigDescriptor != NULL ) {  // 分配了内存
		mUrb = (PURB) ( (PUCHAR)mConfigDescriptor + 256 );  // 指向URB请求块,前256字节保留给配置描述符
		UsbBuildGetDescriptorRequest( mUrb, sizeof( struct _URB_CONTROL_DESCRIPTOR_REQUEST ),  // 构造获取配置描述符的URB
									  USB_CONFIGURATION_DESCRIPTOR_TYPE, 0, 0, mConfigDescriptor, NULL,  // 缓冲区
									  sizeof( USB_CONFIGURATION_DESCRIPTOR ), NULL );  // 配置描述符长度
		mStatus = mUsbSubmitUrb( iDeviceObject, mUrb );  // 提交URB
		if ( NT_SUCCESS( mStatus ) ) {  // 获取了配置描述符
			UsbBuildGetDescriptorRequest( mUrb, sizeof(struct _URB_CONTROL_DESCRIPTOR_REQUEST ),  // 构造获取配置描述符的URB
										  USB_CONFIGURATION_DESCRIPTOR_TYPE, 0, 0, mConfigDescriptor, NULL,  // 缓冲区
										  (ULONG)( mConfigDescriptor -> wTotalLength ), NULL );  // 配置描述符和配置信息的总长度
			mStatus = mUsbSubmitUrb( iDeviceObject, mUrb );  // 提交URB
			if ( NT_SUCCESS( mStatus ) && mConfigDescriptor -> bNumInterfaces == 0 )  // 获取了配置描述符但是不完整
				mStatus = STATUS_DEVICE_DATA_ERROR;  // 接口描述符无效
			if ( NT_SUCCESS( mStatus ) ) {  // 获取了配置描述符且接口描述符有效
				mInterfaceDescriptor = USBD_ParseConfigurationDescriptorEx( mConfigDescriptor, mConfigDescriptor, -1, -1, -1, -1, -1 );
				mInterfaceList[0].InterfaceDescriptor = mInterfaceDescriptor;
				mInterfaceList[0].Interface = NULL;
				mInterfaceList[1].InterfaceDescriptor = NULL;
				mInterfaceList[1].Interface = NULL;
				mUrb = USBD_CreateConfigurationRequestEx( mConfigDescriptor, mInterfaceList );  // 构造配置请求的URB
				if ( mUrb != NULL ) {  // 生成了URB
					mInterface = & mUrb -> UrbSelectConfiguration.Interface;  // 当前接口的信息
					for ( i = 0; i < mInterface -> NumberOfPipes; ++i ) {  // 检查所有端点/管道
						mPipe = & mInterface -> Pipes[ i ];  // 指向管道
						if ( mPipe -> MaximumTransferSize > mMAX_BUFFER_LENGTH ) mPipe -> MaximumTransferSize = mMAX_BUFFER_LENGTH;
					}
					mStatus = mUsbSubmitUrb( iDeviceObject, mUrb );  // 提交URB
					if ( NT_SUCCESS( mStatus ) ) {  // 配置CH375芯片完成
						mInterface = & mUrb -> UrbSelectConfiguration.Interface;  // 当前接口的信息
						for ( i = 0; i < mInterface -> NumberOfPipes; ++i ) {  // 检查所有端点/管道
							mPipe = & mInterface -> Pipes[ i ];  // 指向管道
							if ( mPipe -> MaximumTransferSize > mMAX_BUFFER_LENGTH ) mPipe -> MaximumTransferSize = mMAX_BUFFER_LENGTH;
							switch( mPipe -> EndpointAddress ) {  // 比较端点地址,以确定管道功能
								case 0x81: mDeviceExtension -> mExtInterUpPipe = mPipe -> PipeHandle; break;  // 保存中断数据上传管道的句柄
								case 0x01: mDeviceExtension -> mExtAuxDownPipe = mPipe -> PipeHandle; break;  // 保存辅助数据下传管道的句柄
								case 0x82: mDeviceExtension -> mExtDataUpPipe = mPipe -> PipeHandle; break;  // 保存数据块上传管道的句柄
								case 0x02: mDeviceExtension -> mExtDataDownPipe = mPipe -> PipeHandle; break;  // 保存数据块下传管道的句柄
							}
						}
					}
					ExFreePool( mUrb );  // 释放URB内存
				}
				else mStatus = STATUS_INSUFFICIENT_RESOURCES;  // 无法构造URB
			}
		}
		ExFreePool( mConfigDescriptor );  // 释放配置描述符内存
	}
	return( mStatus );  // 返回状态
}

NTSTATUS	mDeactiveConfig(  // 去除配置
	PDEVICE_OBJECT	iDeviceObject,
	PIRP			iIrp )
{
	ULONG				mPortStatus;
	PURB				mUrb;
	mPDEVICE_EXTENSION	mDeviceExtension;
	NTSTATUS			mStatus = STATUS_INSUFFICIENT_RESOURCES;  // 预置操作失败
	mUrb = ExAllocatePool( NonPagedPool, sizeof( URB ) );  // 分配USB请求块
	if ( mUrb != NULL ) {  // 分配了USB请求块
		UsbBuildSelectConfigurationRequest( mUrb, sizeof( struct _URB_SELECT_CONFIGURATION ), NULL );  // 构造URB请求配置
		mStatus = mUsbSubmitUrb( iDeviceObject, mUrb );  // 提交URB
		ExFreePool( mUrb );  // 释放URB
		mDeviceExtension = iDeviceObject -> DeviceExtension;  // 设备扩展
		mDeviceExtension -> mExtInterUpPipe = NULL;
		mDeviceExtension -> mExtAuxDownPipe = NULL;
		mDeviceExtension -> mExtDataUpPipe = NULL;
		mDeviceExtension -> mExtDataDownPipe = NULL;
	}
	return( mStatus );  // 返回状态
}

NTSTATUS	mUsbSubmitUrb(  // 提交URB请求
	PDEVICE_OBJECT	iDeviceObject,
	PURB			iUrb )
{
	PIRP				mIrp;
	KEVENT				mEvent;
	mPDEVICE_EXTENSION	mDeviceExtension;
	IO_STATUS_BLOCK		mIoStatusBlock;
	NTSTATUS			mStatus = STATUS_INSUFFICIENT_RESOURCES;  // 预置操作失败
	mDeviceExtension = iDeviceObject -> DeviceExtension;  // 设备扩展
	InterlockedIncrement( & mDeviceExtension -> mExtIoCount );  // 操作计数增量,阻止中途停止或者移除设备
	KeInitializeEvent( &mEvent, NotificationEvent, FALSE );  // 初始化IRP完成事件信号为无效
	mIrp = IoBuildDeviceIoControlRequest( IOCTL_INTERNAL_USB_SUBMIT_URB, mDeviceExtension -> mExtNextLowerDevice,
										  NULL, 0, NULL, 0, TRUE, &mEvent, &mIoStatusBlock );  // 构造IRP提交URB
	if ( mIrp != NULL ) {  // IRP有效
		IoGetNextIrpStackLocation( mIrp ) -> Parameters.Others.Argument1 = iUrb;  // 将URB作为参数传递给下级设备
		mStatus = IoCallDriver( mDeviceExtension -> mExtNextLowerDevice, mIrp );  // 向下级设备发送IO请求
		if ( mStatus == STATUS_PENDING ) {  // 等待被悬挂的IO请求完成
			KeWaitForSingleObject( &mEvent, Executive, KernelMode, FALSE, NULL );  // 挂起等待IRP完成
			mStatus = mIoStatusBlock.Status;  // 取完成状态
		}
		if ( mStatus == STATUS_TIMEOUT ) mStatus = STATUS_IO_TIMEOUT;  // 转换出错代码
	}
	InterlockedDecrement( & mDeviceExtension -> mExtIoCount );  // 操作计数减量
	return( mStatus );  // 返回状态
}


// end
