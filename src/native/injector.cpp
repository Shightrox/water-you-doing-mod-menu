#include <windows.h>
#include <algorithm>
#include <tlhelp32.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>
#include <chrono>
namespace fs=std::filesystem;
static std::wstring self_dir(){wchar_t b[32768];DWORD n=GetModuleFileNameW(nullptr,b,32768);return fs::path(std::wstring(b,n)).parent_path().wstring();}
static std::wstring runtime_dir(){wchar_t b[32768];DWORD n=GetEnvironmentVariableW(L"LOCALAPPDATA",b,32768);if(!n)throw std::runtime_error("LOCALAPPDATA is unavailable");return (fs::path(std::wstring(b,n))/L"WaterYouModding"/L"native-runtime").wstring();}
static std::vector<DWORD> games(){std::vector<DWORD> v;HANDLE s=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);if(s==INVALID_HANDLE_VALUE)return v;PROCESSENTRY32W p{sizeof(p)};for(BOOL ok=Process32FirstW(s,&p);ok;ok=Process32NextW(s,&p))if(!_wcsicmp(p.szExeFile,L"WYDRO-Win64-Shipping.exe"))v.push_back(p.th32ProcessID);CloseHandle(s);return v;}
static uintptr_t module(DWORD pid,const std::wstring& name,std::wstring* fullPath=nullptr){HANDLE s=CreateToolhelp32Snapshot(TH32CS_SNAPMODULE|TH32CS_SNAPMODULE32,pid);if(s==INVALID_HANDLE_VALUE)return 0;MODULEENTRY32W m{sizeof(m)};uintptr_t out=0;for(BOOL ok=Module32FirstW(s,&m);ok;ok=Module32NextW(s,&m))if(!_wcsicmp(m.szModule,name.c_str())){out=reinterpret_cast<uintptr_t>(m.modBaseAddr);if(fullPath)*fullPath=m.szExePath;break;}CloseHandle(s);return out;}
static std::string read_file(const fs::path& p){std::ifstream f(p,std::ios::binary);return std::string(std::istreambuf_iterator<char>(f),{});}
static uintptr_t remote_load_library(DWORD pid){auto fn=GetProcAddress(GetModuleHandleW(L"kernel32.dll"),"LoadLibraryW");HMODULE containing=nullptr;if(!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,reinterpret_cast<LPCWSTR>(fn),&containing))throw std::runtime_error("Cannot locate LoadLibraryW");wchar_t path[32768];GetModuleFileNameW(containing,path,32768);auto remote=module(pid,fs::path(path).filename().wstring());if(!remote)throw std::runtime_error("System loader module is missing");return remote+reinterpret_cast<uintptr_t>(fn)-reinterpret_cast<uintptr_t>(containing);}
static void remote_call(HANDLE process,uintptr_t address,void* argument){HANDLE thread=CreateRemoteThread(process,nullptr,0,reinterpret_cast<LPTHREAD_START_ROUTINE>(address),argument,0,nullptr);if(!thread)throw std::runtime_error("Cannot start the mod loader, Windows error "+std::to_string(GetLastError()));DWORD result=WaitForSingleObject(thread,20000);CloseHandle(thread);if(result!=WAIT_OBJECT_0)throw std::runtime_error("Game did not finish loading the mod within 20 seconds");}
int wmain(int argc,wchar_t** argv){SetConsoleOutputCP(CP_UTF8);try{
 const fs::path dll=fs::path(self_dir())/L"WydNative.dll";
 if(!fs::is_regular_file(dll))throw std::runtime_error("WydNative.dll is missing");
 if(argc>1&&!wcscmp(argv[1],L"--check")){auto mod=LoadLibraryExW(dll.c_str(),nullptr,DONT_RESOLVE_DLL_REFERENCES);if(!mod)throw std::runtime_error("Invalid native DLL");bool ok=GetProcAddress(mod,"WydStart")!=nullptr;FreeLibrary(mod);if(!ok)throw std::runtime_error("Native entry point is missing");std::cout<<"PACKAGE CHECK PASSED: native DLL, no Python or Frida dependency.\n";return 0;}
 auto list=games();if(list.empty()){std::cout<<"Start Water You Doing and enter a game. Waiting up to two minutes...\n";for(int i=0;i<120&&list.empty();i++){Sleep(1000);list=games();}}
 if(list.empty())throw std::runtime_error("Game not found. Start the game, then run this BAT again");if(list.size()!=1)throw std::runtime_error("Close duplicate game instances first");DWORD pid=list[0];
 HANDLE process=OpenProcess(PROCESS_CREATE_THREAD|PROCESS_QUERY_INFORMATION|PROCESS_VM_OPERATION|PROCESS_VM_WRITE|PROCESS_VM_READ|SYNCHRONIZE,FALSE,pid);if(!process)throw std::runtime_error("Cannot open game, Windows error "+std::to_string(GetLastError()));
 fs::path status=fs::path(runtime_dir())/L"startup.json";
 std::wstring existingPath;
 auto existing=module(pid,L"WydNative.dll",&existingPath);
 if(!existing){
  std::error_code ec; fs::remove(status,ec);
  auto path=dll.wstring();SIZE_T bytes=(path.size()+1)*sizeof(wchar_t);void* remote=VirtualAllocEx(process,nullptr,bytes,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);if(!remote){CloseHandle(process);throw std::runtime_error("Cannot allocate loader path");}
  SIZE_T written=0;if(!WriteProcessMemory(process,remote,path.c_str(),bytes,&written)||written!=bytes){VirtualFreeEx(process,remote,0,MEM_RELEASE);CloseHandle(process);throw std::runtime_error("Cannot write loader path");}
  try {remote_call(process,remote_load_library(pid),remote);}catch(...){CloseHandle(process);throw;} // keep path alive if the remote loader timed out
  VirtualFreeEx(process,remote,0,MEM_RELEASE);
  if(!module(pid,L"WydNative.dll")){CloseHandle(process);auto detail=read_file(status);throw std::runtime_error(detail.empty()?"Windows could not load the native mod":detail);}
 }else{
  std::error_code sameFileError;
  if(!fs::equivalent(fs::path(existingPath),dll,sameFileError)||sameFileError){CloseHandle(process);throw std::runtime_error("A different mod version is active. Press F10 to disable it, then run this BAT again.");}
  HMODULE local=LoadLibraryExW(dll.c_str(),nullptr,DONT_RESOLVE_DLL_REFERENCES);if(!local){CloseHandle(process);throw std::runtime_error("Cannot inspect native entry point");}
  auto entry=GetProcAddress(local,"WydStart");if(!entry){FreeLibrary(local);CloseHandle(process);throw std::runtime_error("Native entry point is missing");}
  uintptr_t start=existing+reinterpret_cast<uintptr_t>(entry)-reinterpret_cast<uintptr_t>(local);FreeLibrary(local);remote_call(process,start,nullptr);
 }
 for(int i=0;i<250;i++){
  auto text=read_file(status);auto compact=text;compact.erase(std::remove_if(compact.begin(),compact.end(),[](unsigned char c){return c==' '||c=='\r'||c=='\n'||c=='\t';}),compact.end());
  if(compact.find("\"pid\":"+std::to_string(pid)+",")==std::string::npos){Sleep(100);continue;}
  if(compact.find("\"state\":\"ready\"")!=std::string::npos){CloseHandle(process);std::cout<<"Ready! F8: menu. F10: disable mod.\n";return 0;}
  if(compact.find("\"state\":\"failed\"")!=std::string::npos||compact.find("\"state\":\"error\"")!=std::string::npos){CloseHandle(process);throw std::runtime_error(text);}
  if(WaitForSingleObject(process,0)==WAIT_OBJECT_0){CloseHandle(process);throw std::runtime_error("Game exited before the mod started");}Sleep(100);
 }
 CloseHandle(process);throw std::runtime_error("Startup was not confirmed. See LOCALAPPDATA/WaterYouModding/native-runtime/startup.json");
 }catch(const std::exception& e){std::cerr<<"ERROR: "<<e.what()<<"\n";return 1;}}

