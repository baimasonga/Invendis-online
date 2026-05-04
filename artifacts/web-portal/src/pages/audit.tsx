import { useState } from "react";
import { useListAuditLogs } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

export default function AuditLogs() {
  const [page, setPage] = useState(1);
  const { data: logsData, isLoading } = useListAuditLogs({ page, limit: 50 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
        <p className="text-muted-foreground">System-wide trace of all actions and modifications.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    </TableRow>
                  ))
                ) : logsData?.data && logsData.data.length > 0 ? (
                  logsData.data.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</TableCell>
                      <TableCell>{log.username || 'System'}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded-md text-xs font-medium ${
                          log.action === 'CREATE' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                          log.action === 'UPDATE' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                          log.action === 'DELETE' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                          'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                        }`}>
                          {log.action}
                        </span>
                      </TableCell>
                      <TableCell>{log.module}</TableCell>
                      <TableCell className="max-w-md truncate" title={log.description}>{log.description}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No audit logs found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
