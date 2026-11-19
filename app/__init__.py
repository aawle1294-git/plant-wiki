# app package
def __getattr__(name):
    import main
    return getattr(main, name)
