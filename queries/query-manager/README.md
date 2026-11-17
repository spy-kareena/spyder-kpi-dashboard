# The six queries saved in Query Manager (Kareena - Qry, 10.19)

Copies of the SAP bridge's `sql/qm_*.sql` files (github.com/DavidP-M/SAP-app): each is the saved query byte for byte
after a two-line header. Live SAP (2v6.9, four queries) reads 1 to 4 as the KPI data; 5 (production orders and
kitting) and 6 (MRP forecast) are served by the bridge but not read by any page yet.

When a saved query changes in Query Manager, change it in the bridge (its tests pin the text) and copy the file here.
