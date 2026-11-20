; x64 midpoint hook. At the verified game site RBX still contains AHUD*.
; The trampoline executes mov rbx,[rsp+0B8h], then the original epilogue.
; Do not enter this stub with CALL: MinHook branches to it with JMP.
OPTION CASEMAP:NONE
EXTERN OnHud:PROC
EXTERN g_HudTrampoline:QWORD
EXTERN g_HudActive:DWORD
PUBLIC HudDetour

.code
HudDetour PROC
    pushfq
    lock inc DWORD PTR [g_HudActive]
    push rax
    push rcx
    push rdx
    push r8
    push r9
    push r10
    push r11
    push rbp
    mov rbp, rsp
    and rsp, -16
    sub rsp, 80h             ; 20h shadow space + six saved XMM registers
    movdqu XMMWORD PTR [rsp+20h], xmm0
    movdqu XMMWORD PTR [rsp+30h], xmm1
    movdqu XMMWORD PTR [rsp+40h], xmm2
    movdqu XMMWORD PTR [rsp+50h], xmm3
    movdqu XMMWORD PTR [rsp+60h], xmm4
    movdqu XMMWORD PTR [rsp+70h], xmm5
    mov rcx, rbx
    call OnHud
    movdqu xmm0, XMMWORD PTR [rsp+20h]
    movdqu xmm1, XMMWORD PTR [rsp+30h]
    movdqu xmm2, XMMWORD PTR [rsp+40h]
    movdqu xmm3, XMMWORD PTR [rsp+50h]
    movdqu xmm4, XMMWORD PTR [rsp+60h]
    movdqu xmm5, XMMWORD PTR [rsp+70h]
    mov rsp, rbp
    pop rbp
    pop r11
    pop r10
    pop r9
    pop r8
    pop rdx
    pop rcx
    pop rax
    lock dec DWORD PTR [g_HudActive]
    popfq
    jmp QWORD PTR [g_HudTrampoline]
HudDetour ENDP
END
