{
    'name': 'CRM Live Dashboard',
    'version': '18.0.1.0.0',
    'category': 'CRM',
    'summary': 'Real-time CRM pipeline dashboard',
    'depends': ['crm', 'web'],
    'data': ['views/menu.xml'],
    'assets': {
        'web.assets_backend': [
            'crm_live_dashboard/static/src/css/dashboard.css',
            'crm_live_dashboard/static/src/xml/dashboard.xml',
            'crm_live_dashboard/static/src/js/dashboard.js',
        ],
    },
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
