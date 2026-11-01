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

#ifndef		_CH375_DLL_H
#define		_CH375_DLL_H

#ifdef __cplusplus
extern "C" {
#endif

#define		mOFFSET( s, m )			( (ULONG) & ( ( ( s * ) 0 ) -> m ) )	// 定义获取结构成员相对偏移地址的宏

#ifndef		max
#define		max( a, b )				( ( ( a ) > ( b ) ) ? ( a ) : ( b ) )	// 较大值
#endif

#ifndef		min
#define		min( a, b )				( ( ( a ) < ( b ) ) ? ( a ) : ( b ) )	// 较小值
#endif

#ifdef		ExAllocatePool
#undef		ExAllocatePool						// 删除带TAG的内存分配
#endif

#ifndef		NTSTATUS
typedef		LONG	NTSTATUS;					// 返回状态
#endif


typedef	struct	_USB_SETUP_PKT {				// USB控制传输的建立阶段的数据请求包结构
	UCHAR			mUspReqType;				// 00H 请求类型
	UCHAR			mUspRequest;				// 01H 请求代码
	union	{
		struct	{
			UCHAR	mUspValueLow;				// 02H 值参数低字节
			UCHAR	mUspValueHigh;				// 03H 值参数高字节
		};
		USHORT		mUspValue;					// 02H-03H 值参数
	};
	union	{
		struct	{
			UCHAR	mUspIndexLow;				// 04H 索引参数低字节
			UCHAR	mUspIndexHigh;				// 05H 索引参数高字节
		};
		USHORT		mUspIndex;					// 04H-05H 索引参数
	};
	USHORT			mLength;					// 06H-07H 数据阶段的数据长度
} mUSB_SETUP_PKT, *mPUSB_SETUP_PKT;


#define		mCH375_PACKET_LENGTH	64			// CH375支持的数据包的长度
#define		mCH375_PKT_LEN_SHORT	8			// CH375支持的短数据包的长度


typedef	struct	_WIN32_COMMAND {				// 定义WIN32命令接口结构
	union	{
		ULONG		mFunction;					// 输入时指定功能代码或者管道号
		NTSTATUS	mStatus;					// 输出时返回操作状态
	};
	ULONG			mLength;					// 存取长度,返回后续数据的长度
	union	{
		mUSB_SETUP_PKT	mSetupPkt;				// USB控制传输的建立阶段的数据请求
		UCHAR			mBuffer[ mCH375_PACKET_LENGTH ];	// 数据缓冲区,长度为0至255B
	};
} mWIN32_COMMAND, *mPWIN32_COMMAND;


// WIN32应用层接口命令
#define		IOCTL_CH375_COMMAND		( FILE_DEVICE_UNKNOWN << 16 | FILE_ANY_ACCESS << 14 | 0x0f37 << 2 | METHOD_BUFFERED )	// 专用接口

#define		mWIN32_COMMAND_HEAD		mOFFSET( mWIN32_COMMAND, mBuffer )	// WIN32命令接口的头长度

#define		mMAX_BUFFER_LENGTH		0x0400		// 数据缓冲区最大长度1024

#define		mMAX_COMMAND_LENGTH		( mWIN32_COMMAND_HEAD + mMAX_BUFFER_LENGTH )	// 最大数据长度加上命令结构头的长度


// 设备层接口提供的管道操作命令
#define		mPipeDeviceCtrl			0x00000004	// CH375的综合控制管道
#define		mPipeInterUp			0x00000005	// CH375的中断数据上传管道
#define		mPipeDataUp				0x00000006	// CH375的数据块上传管道
#define		mPipeDataDown			0x00000007	// CH375的数据块下传管道
#define		mPipeAuxDown			0x00000008	// CH375的辅助数据下传管道

// 应用层接口的功能代码
#define		mFuncGetVersion			0x00000001	// 获取驱动程序版本号
#define		mFuncResetPipe			0x0000000d	// 复位USB管道
#define		mFuncAbortPipe			0x0000000e	// 取消USB管道的数据请求


typedef		VOID	( CALLBACK	* mPCH375_INT_ROUTINE ) (  // 中断服务回调程序
	PUCHAR			iBuffer );  // 指向一个缓冲区,提供当前的中断特征数据


ULONG	WINAPI	CH375GetVersion( );  // 获得DLL版本号,返回版本号


PVOID	WINAPI	CH375GetDeviceName(  // 返回指向CH375设备名称的缓冲区,出错则返回NULL
	ULONG			iIndex );  // 指定CH375设备序号,0对应第一个设备


HANDLE	WINAPI	CH375OpenDevice(  // 打开CH375设备,返回句柄,出错则无效
	ULONG			iIndex );  // 指定CH375设备序号,0对应第一个设备


VOID	WINAPI	CH375CloseDevice(  // 关闭CH375设备
	ULONG			iIndex );  // 指定CH375设备序号,必须是0


ULONG	WINAPI	CH375DriverCommand(  // 直接传递命令给驱动程序,出错则返回0,否则返回数据长度
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	mPWIN32_COMMAND	ioCommand );  // 命令结构的指针
// 该程序在调用后返回数据长度,并且仍然返回命令结构,如果是读操作,则数据返回在命令结构中,
// 返回的数据长度在操作失败时为0,操作成功时为整个命令结构的长度,例如读一个字节,则返回mWIN32_COMMAND_HEAD+1,
// 命令结构在调用前,分别提供:管道号或者命令功能代码,存取数据的长度(可选),数据(可选)
// 命令结构在调用后,分别返回:操作状态代码,后续数据的长度(可选),
//   操作状态代码是由WINDOWS定义的代码,可以参考NTSTATUS.H,
//   后续数据的长度是指读操作返回的数据长度,数据存放在随后的缓冲区中,对于写操作一般为0


BOOL	WINAPI	CH375GetDeviceDescr(  // 读取设备描述符
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	PVOID			oBuffer,  // 指向一个足够大的缓冲区,用于保存描述符
	PULONG			ioLength );  // 指向长度单元,输入时为准备读取的长度,返回后为实际读取的长度


BOOL	WINAPI	CH375GetConfigDescr(  // 读取配置描述符
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	PVOID			oBuffer,  // 指向一个足够大的缓冲区,用于保存描述符
	PULONG			ioLength );  // 指向长度单元,输入时为准备读取的长度,返回后为实际读取的长度


BOOL	WINAPI	CH375ReadData(  // 读取数据块
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	PVOID			oBuffer,  // 指向一个足够大的缓冲区,用于保存读取的数据
	PULONG			ioLength );  // 指向长度单元,输入时为准备读取的长度,返回后为实际读取的长度


BOOL	WINAPI	CH375AbortRead(  // 放弃数据块读操作
	ULONG			iIndex );  // 指定CH375设备序号,必须是0


BOOL	WINAPI	CH375ResetRead(  // 复位数据块读操作
	ULONG			iIndex );  // 指定CH375设备序号,必须是0


BOOL	WINAPI	CH375WriteData(  // 写出数据块
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	PVOID			iBuffer,  // 指向一个缓冲区,放置准备写出的数据
	PULONG			ioLength );  // 指向长度单元,输入时为准备写出的长度,返回后为实际写出的长度


BOOL	WINAPI	CH375AbortWrite(  // 放弃数据块写操作
	ULONG			iIndex );  // 指定CH375设备序号,必须是0


BOOL	WINAPI	CH375ResetWrite(  // 复位数据块写操作
	ULONG			iIndex );  // 指定CH375设备序号,必须是0


BOOL	WINAPI	CH375ReadInter(  // 读取中断数据
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	PVOID			oBuffer,  // 指向一个足够大的缓冲区,用于保存读取的中断数据
	PULONG			ioLength );  // 指向长度单元,输入时为准备读取的长度,返回后为实际读取的长度


BOOL	WINAPI	CH375AbortInter(  // 放弃中断数据读操作
	ULONG			iIndex );  // 指定CH375设备序号,必须是0


BOOL	WINAPI	CH375ResetInter(  // 复位中断数据读操作
	ULONG			iIndex );  // 指定CH375设备序号,必须是0


BOOL	WINAPI	CH375SetIntRoutine(  // 设定中断服务程序
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	mPCH375_INT_ROUTINE	iIntRoutine );  // 指定中断服务回调程序,为NULL则取消中断服务,否则在中断时调用该程序


BOOL	WINAPI	CH375WriteAuxData(  // 写出辅助数据
	ULONG			iIndex,  // 指定CH375设备序号,必须是0
	PVOID			iBuffer,  // 指向一个缓冲区,放置准备写出的数据
	PULONG			ioLength );  // 指向长度单元,输入时为准备写出的长度,返回后为实际写出的长度


BOOL	WINAPI	CH375ResetAux(  // 复位辅助数据写操作
	ULONG			iIndex );  // 指定CH375设备序号,必须是0


#ifdef __cplusplus
}
#endif

#endif		// _CH375_DLL_H
