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

#ifndef		_CH375_WDM_H
#define		_CH375_WDM_H


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


static const GUID CH375Guid = { 0x5e7f6bdf, 0x1ce5, 0x4d78, { 0xbb, 0xcf, 0xd2, 0xc, 0x44, 0x32, 0x9f, 0x7d } };	// GUID

#endif		// _CH375_WDM_H
