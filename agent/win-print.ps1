# RailServe print agent: the Windows print queue, for print-agent.mjs.
#
# What lp, lpstat and cancel do for the agent on macOS and Linux. It runs this
# with one of:
#   submit <file>   send the file's bytes to the printer as ONE raw job and
#                   write the job's id
#   pending         write the ids of this printer's jobs not yet printed
#   cancel <id>     cancel one job
#   status          write what is wrong with the printer, or nothing
# The printer's name comes in RS_PRINTER, so no quoting can mangle it.
#
# RAW means the printer driver passes the bytes through untouched, so the only
# cuts are the ones the agent put in them, one after every ticket.
#
# Plain ASCII on purpose: Windows PowerShell 5.1 reads a file without a BOM
# in the computer's own code page.
param([string]$Action, [string]$Arg)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class RailServeRawPrint
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DocInfo
    {
        public string DocName;
        public string OutputFile;
        public string DataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr printer);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int StartDocPrinter(IntPtr printer, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo info);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool StartPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndPagePrinter(IntPtr printer);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr printer, IntPtr bytes, int count, out int written);

    static Exception Failed(string what)
    {
        return new Exception(what + ": " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
    }

    // Returns the spooler's id for the job.
    public static int Send(string name, string title, byte[] bytes)
    {
        IntPtr printer;
        if (!OpenPrinter(name, out printer, IntPtr.Zero)) throw Failed("cannot open printer \"" + name + "\"");
        GCHandle pinned = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        try
        {
            DocInfo info = new DocInfo();
            info.DocName = title;
            info.DataType = "RAW";
            int job = StartDocPrinter(printer, 1, info);
            if (job == 0) throw Failed("the printer refused a raw job");
            try
            {
                if (!StartPagePrinter(printer)) throw Failed("StartPagePrinter");
                int sent = 0;
                while (sent < bytes.Length)
                {
                    int written;
                    IntPtr at = IntPtr.Add(pinned.AddrOfPinnedObject(), sent);
                    if (!WritePrinter(printer, at, bytes.Length - sent, out written)) throw Failed("WritePrinter");
                    if (written <= 0) throw new Exception("the print queue stopped taking data");
                    sent += written;
                }
                EndPagePrinter(printer);
            }
            finally
            {
                EndDocPrinter(printer);
            }
            return job;
        }
        finally
        {
            pinned.Free();
            ClosePrinter(printer);
        }
    }
}
'@

try {
    $printer = $env:RS_PRINTER
    if (-not $printer) { throw 'RS_PRINTER is not set.' }

    switch ($Action) {
        'submit' {
            Add-Type -TypeDefinition $source
            $bytes = [System.IO.File]::ReadAllBytes($Arg)
            [Console]::Out.WriteLine([RailServeRawPrint]::Send($printer, 'RailServe KOT', $bytes))
        }
        'pending' {
            foreach ($job in @(Get-PrintJob -PrinterName $printer)) {
                # 0x80 printed, 0x1000 complete: a printer set to keep printed
                # documents still lists them, and they are done.
                if (([uint32]$job.JobStatus -band 0x1080) -ne 0) { continue }
                [Console]::Out.WriteLine($job.Id)
            }
        }
        'cancel' {
            Remove-PrintJob -PrinterName $printer -ID ([uint32]$Arg)
        }
        'status' {
            $state = [string](Get-Printer -Name $printer).PrinterStatus
            if ($state -and $state -ne 'Normal') { [Console]::Out.WriteLine("printer status: $state") }
        }
        default { throw "unknown action: $Action" }
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
